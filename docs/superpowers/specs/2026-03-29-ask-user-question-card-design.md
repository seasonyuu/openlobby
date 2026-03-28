# AskUserQuestion 问答卡片渲染

**Date:** 2026-03-29
**Status:** Approved

## Problem

当 Claude Code SDK 模型调用 `AskUserQuestion` 工具时，OpenLobby 将其当作普通工具显示 Allow/Deny 审批卡片。用户无法看到问题和选项，也无法选择回答。需要检测该工具名，渲染为带选项的问答卡片（支持单选/多选），并将用户选择注入回 SDK。

## SDK `AskUserQuestionInput` 结构

```typescript
{
  questions: Array<{       // 1-4 个问题
    question: string;      // 问题文本
    header: string;        // 短标签 (max 12 chars)
    options: Array<{       // 2-4 个选项
      label: string;       // 选项标签
      description: string; // 选项描述
    }>;
    multiSelect: boolean;  // true=多选, false=单选
  }>;
  answers?: Record<string, string>;  // 用户答案 {"0":"label", "1":"a,b"}
}
```

SDK 期望 `canUseTool` 返回：
```typescript
{ behavior: 'allow', updatedInput: { ...toolInput, answers: { "0": "selectedLabel", ... } } }
```

## Decision Summary

| Decision | Choice |
|----------|--------|
| Trigger | SDK `canUseTool` callback where `toolName === 'AskUserQuestion'` |
| Response mechanism | `respondControl(requestId, 'allow', payload)` — keep allow/deny, add optional payload |
| IM option rendering | Inline callback buttons (one per option, callbackData carries routing info) |
| IM multi-question | Send one question at a time, advance after each answer |

## Design

### 1. Core Types (`packages/core/src/types.ts`)

Extend `ControlRequest` with optional `questions` field:

```typescript
export interface ControlRequest {
  requestId: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  // New: structured question data when toolName === 'AskUserQuestion'
  questions?: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
}
```

Extend `AgentProcess.respondControl` signature:

```typescript
respondControl(requestId: string, decision: ControlDecision, payload?: Record<string, unknown>): void;
```

### 2. Claude Code Adapter (`packages/core/src/adapters/claude-code.ts`)

- `handleToolApproval`: When `toolName === 'AskUserQuestion'`, extract `toolInput.questions` and include it in the emitted `control` LobbyMessage.
- `respondControl`: When `decision === 'allow'` and `payload?.answers` exists, inject answers into `updatedInput`:
  ```typescript
  { behavior: 'allow', updatedInput: { ...toolInput, answers: payload.answers } }
  ```

### 3. WebSocket Protocol (`packages/core/src/protocol.ts`)

- `control.request` ServerMessage: add optional `questions` field
- `control.respond` ClientMessage: add optional `payload` field

### 4. Web Frontend — New Component `QuestionCard.tsx`

- `MessageList` checks if pending control has `questions`:
  - Yes → render `QuestionCard`
  - No → render existing `ControlCard`
- Each question renders: `header` tag + `question` text + option list
  - `multiSelect: false` → Radio buttons (single select)
  - `multiSelect: true` → Checkboxes (multi select)
- Auto-add "Other" free-text input option (SDK documentation requires this)
- Bottom "Confirm" button submits all answers:
  ```typescript
  wsRespondControl(sessionId, requestId, 'allow', {
    answers: { "0": "label1", "1": "label2,label3" }
  })
  ```

### 5. Web Frontend — State Layer (`lobby-store.ts`, `useWebSocket.ts`)

- `ControlRequestData` interface: add optional `questions` field
- `wsRespondControl` function: add optional `payload` parameter
- `control.request` handler: pass through `questions` to store

### 6. Server Layer (`ws-handler.ts`, `session-manager.ts`)

- `control.respond` handling: parse and pass through `payload`
- `SessionManager.respondControl` signature: add `payload`, pass through to adapter

### 7. IM Channel (`channel-router.ts`)

Detect `questions` field in control messages:

**With questions — sequential question interaction:**

- Maintain per-identity state: `pendingQuestions: Map<identityKey, { sessionId, requestId, questions, currentIndex, answers }>`
- Send first question with inline callback buttons:
  - Single-select button callbackData: `askq:${sessionId}:${requestId}:${questionIndex}:${optionIndex}`
  - Multi-select toggle button callbackData: `askt:${sessionId}:${requestId}:${questionIndex}:${optionIndex}`
  - Multi-select confirm button callbackData: `askc:${sessionId}:${requestId}:${questionIndex}`
- Single-select: clicking a button records the answer, advances to next question
- Multi-select: clicking toggles selection state, clicking confirm advances
- After last question answered: aggregate all answers → `respondControl('allow', { answers })`

**Without questions — existing Allow/Deny button behavior unchanged.**

### Data Flow

```
SDK model calls AskUserQuestion(toolInput)
  → canUseTool("AskUserQuestion", toolInput)
  → adapter detects toolName, emits control msg with questions
  → SessionManager broadcasts

  Web path:
    → control.request {questions} → store → QuestionCard renders
    → User selects options → wsRespondControl('allow', {answers})
    → ws-handler → SessionManager → adapter
    → { behavior:'allow', updatedInput: { ...toolInput, answers } }

  IM path:
    → channel-router detects questions
    → sends question 1 with option buttons
    → user clicks button → callback → record answer
    → sends question 2 → ... → all answered
    → respondControl('allow', {answers})
    → same adapter flow
```

### Unchanged

- Regular tool approvals (non-AskUserQuestion) flow unchanged
- Existing `ChoiceCard` (`<!-- CHOICE -->` embedded) unchanged
- Existing `ControlCard` component retained for regular approvals

## Files to Modify

| File | Change |
|------|--------|
| `packages/core/src/types.ts` | Extend `ControlRequest`, `AgentProcess.respondControl` signature |
| `packages/core/src/protocol.ts` | Extend `control.request` and `control.respond` messages |
| `packages/core/src/adapters/claude-code.ts` | Detect AskUserQuestion, inject answers into updatedInput |
| `packages/web/src/components/QuestionCard.tsx` | New component: question card with single/multi select |
| `packages/web/src/components/MessageList.tsx` | Conditional render QuestionCard vs ControlCard |
| `packages/web/src/stores/lobby-store.ts` | Extend ControlRequestData with questions |
| `packages/web/src/hooks/useWebSocket.ts` | Extend wsRespondControl with payload, pass questions |
| `packages/server/src/ws-handler.ts` | Pass through questions and payload |
| `packages/server/src/session-manager.ts` | Extend respondControl with payload |
| `packages/server/src/channel-router.ts` | Sequential question interaction with callback buttons |
