# `/stop` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `interrupt()` method to `AgentProcess` and a `/stop` command (IM + Web) that aborts the current model response without destroying the session.

**Architecture:** New `interrupt()` on `AgentProcess` does a "soft abort" (stream abort → idle, no exit event). Exposed via `session.interrupt` WS message, `/stop` slash command, and a Stop button in the web UI that replaces the Send button while a session is running.

**Tech Stack:** TypeScript, Fastify/WebSocket, React/Tailwind

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/core/src/types.ts` | Modify | Add `interrupt()` to `AgentProcess` interface |
| `packages/core/src/protocol.ts` | Modify | Add `session.interrupt` client message |
| `packages/core/src/adapters/claude-code.ts` | Modify | Implement `interrupt()` |
| `packages/core/src/adapters/opencode.ts` | Modify | Implement `interrupt()` |
| `packages/core/src/adapters/codex-cli.ts` | Modify | Implement `interrupt()` |
| `packages/server/src/session-manager.ts` | Modify | Add `interruptSession()` |
| `packages/server/src/ws-handler.ts` | Modify | Handle `session.interrupt` |
| `packages/server/src/slash-commands.ts` | Modify | Add `/stop` case and help text |
| `packages/server/src/channel-router.ts` | Modify | Add `/stop` IM dispatch |
| `packages/web/src/hooks/useWebSocket.ts` | Modify | Add `wsInterruptSession()` |
| `packages/web/src/components/MessageInput.tsx` | Modify | Add Stop button |

---

### Task 1: Add `interrupt()` to `AgentProcess` interface and protocol

**Files:**
- Modify: `packages/core/src/types.ts:69-80`
- Modify: `packages/core/src/protocol.ts:17-52`

- [ ] **Step 1: Add `interrupt()` to `AgentProcess` interface**

In `packages/core/src/types.ts`, add `interrupt()` to the `AgentProcess` interface after `kill()`:

```typescript
// In the AgentProcess interface (line 79, after kill(): void;)
  interrupt(): void;
```

The full interface becomes:

```typescript
export interface AgentProcess extends EventEmitter {
  sessionId: string;
  readonly adapter: string;
  status: 'running' | 'idle' | 'stopped' | 'error' | 'awaiting_approval';

  sendMessage(content: string): void;
  respondControl(requestId: string, decision: ControlDecision, payload?: Record<string, unknown>): void;
  updateOptions(opts: Partial<SpawnOptions>): void;
  setPlanMode?(enabled: boolean): void;
  kill(): void;
  interrupt(): void;
}
```

- [ ] **Step 2: Add `session.interrupt` to `ClientMessage` type**

In `packages/core/src/protocol.ts`, add a new union member to `ClientMessage` (after the `session.destroy` line):

```typescript
  | { type: 'session.interrupt'; sessionId: string }
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @openlobby/core build`
Expected: Build fails because adapters don't implement `interrupt()` yet — that's correct.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/protocol.ts
git commit -m "feat(core): add interrupt() to AgentProcess interface and session.interrupt protocol message"
```

---

### Task 2: Implement `interrupt()` in Claude Code adapter

**Files:**
- Modify: `packages/core/src/adapters/claude-code.ts:464-476`

- [ ] **Step 1: Add `interrupt()` method to `ClaudeCodeProcess`**

In `packages/core/src/adapters/claude-code.ts`, add the `interrupt()` method immediately before the `kill()` method (before line 464):

```typescript
  interrupt(): void {
    if (this.status !== 'running' && this.status !== 'awaiting_approval') return;
    console.log('[ClaudeCode] Interrupting current generation');
    this.abortController.abort();
    this.pendingControls.clear();
    this.preRespondedControls.clear();
    this.status = 'idle';
    this.emit('idle');
  }
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @openlobby/core build`
Expected: Still fails (other adapters missing `interrupt()`).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/adapters/claude-code.ts
git commit -m "feat(claude-code): implement interrupt() for soft abort"
```

---

### Task 3: Implement `interrupt()` in OpenCode adapter

**Files:**
- Modify: `packages/core/src/adapters/opencode.ts:382-393`

- [ ] **Step 1: Add `interrupt()` method to `OpenCodeProcess`**

In `packages/core/src/adapters/opencode.ts`, add the `interrupt()` method immediately before the `kill()` method (before line 382):

```typescript
  interrupt(): void {
    if (this.status !== 'running' && this.status !== 'awaiting_approval') return;
    console.log('[OpenCode] Interrupting current generation');
    // Abort SSE and create fresh controller for next message
    this.sseAbortController.abort();
    this.sseAbortController = new AbortController();
    // Tell OpenCode server to stop generation (best-effort)
    this.client.session
      .abort({ path: { id: this.sessionId } })
      .catch(() => {});
    this.status = 'idle';
    this.emit('idle');
    // Re-subscribe to SSE with the new controller
    this.subscribeSSE().catch((err: unknown) => {
      console.error('[OpenCode] Re-subscribe after interrupt failed:', err);
    });
  }
```

Note: OpenCode's SSE is a long-lived stream. After aborting, we need a new `AbortController` and re-subscribe so future events are still received. This differs from Claude Code where `sendMessage()` creates a fresh `AbortController` each time.

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @openlobby/core build`
Expected: Still fails (codex-cli missing `interrupt()`).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/adapters/opencode.ts
git commit -m "feat(opencode): implement interrupt() with SSE re-subscribe"
```

---

### Task 4: Implement `interrupt()` in Codex CLI adapter

**Files:**
- Modify: `packages/core/src/adapters/codex-cli.ts:379-399`

- [ ] **Step 1: Add `interrupt()` method to `CodexCliProcess`**

In `packages/core/src/adapters/codex-cli.ts`, add the `interrupt()` method immediately before the `kill()` method (before line 379):

```typescript
  interrupt(): void {
    if (this.status !== 'running' && this.status !== 'awaiting_approval') return;
    console.log('[Codex] Interrupting current generation');
    // Codex CLI has no cancel RPC — kill the child process.
    // It will be lazily recreated on the next sendMessage().
    this.killedIntentionally = true;
    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = null;
    }
    this.status = 'idle';
    this.emit('idle');
  }
```

- [ ] **Step 2: Verify full core build**

Run: `pnpm --filter @openlobby/core build`
Expected: PASS — all 3 adapters now implement `interrupt()`.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/adapters/codex-cli.ts
git commit -m "feat(codex-cli): implement interrupt() via child process kill"
```

---

### Task 5: Add `interruptSession()` to SessionManager

**Files:**
- Modify: `packages/server/src/session-manager.ts:780-789`

- [ ] **Step 1: Add `interruptSession()` method**

In `packages/server/src/session-manager.ts`, add the `interruptSession()` method before `destroySession()` (before line 780):

```typescript
  async interruptSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.process.interrupt();
    // Status update and broadcast are driven by adapter emit('idle')
    // via the existing wireProcessEvents 'idle' handler.
  }
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @openlobby/server build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/session-manager.ts
git commit -m "feat(server): add interruptSession() to SessionManager"
```

---

### Task 6: Handle `session.interrupt` in ws-handler

**Files:**
- Modify: `packages/server/src/ws-handler.ts:150-160`

- [ ] **Step 1: Add `session.interrupt` case to ws-handler**

In `packages/server/src/ws-handler.ts`, add a new case inside the `switch (data.type)` block. Add it after the `'control.respond'` case (after line 160):

```typescript
        case 'session.interrupt': {
          await sessionManager.interruptSession(data.sessionId);
          break;
        }
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @openlobby/server build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/ws-handler.ts
git commit -m "feat(server): handle session.interrupt WS message"
```

---

### Task 7: Add `/stop` slash command

**Files:**
- Modify: `packages/server/src/slash-commands.ts:42-64`
- Modify: `packages/server/src/slash-commands.ts:66-82`

- [ ] **Step 1: Add `targetSessionId` to `SlashCommandContext`**

In `packages/server/src/slash-commands.ts`, add `targetSessionId` to `SlashCommandContext` (line 15-18):

```typescript
export interface SlashCommandContext {
  sessionManager: SessionManager;
  lmSessionId: string | null;
  /** The session to target for /stop — the session the user is currently viewing (not the LM session) */
  targetSessionId?: string;
}
```

- [ ] **Step 2: Add `/stop` case to `handleSlashCommand`**

In the `switch (cmd)` block (after the `/exit` case at line 52), add:

```typescript
    case '/stop':
      return await cmdStop(ctx);
```

- [ ] **Step 3: Implement `cmdStop` function**

Add this function after `cmdRm` (after line 169):

```typescript
async function cmdStop(ctx: SlashCommandContext): Promise<SlashCommandResult> {
  const targetId = ctx.targetSessionId;
  if (!targetId) {
    return { text: '⚠️ 当前没有正在运行的会话。' };
  }
  await ctx.sessionManager.interruptSession(targetId);
  return { text: '⏹ 已打断模型回复。' };
}
```

- [ ] **Step 4: Add `/stop` to help text**

In the `cmdHelp` function, add this line after the `/exit` entry (after line 75):

```typescript
      '`/stop` — 打断当前模型回复',
```

- [ ] **Step 5: Verify build**

Run: `pnpm --filter @openlobby/server build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/slash-commands.ts
git commit -m "feat(server): add /stop slash command"
```

---

### Task 8: Wire `/stop` in ws-handler caller

**Files:**
- Modify: `packages/server/src/ws-handler.ts:115-145`

The `/stop` command needs `targetSessionId` in the context. When the user sends `/stop` in the LM session, the target is the session they're currently viewing. But from the LM session, we don't directly know which session the user views.

The simplest approach: when `/stop` is sent in the LM session without a target, it's a no-op. When `/stop` is sent while viewing a specific session (not LM), it targets that session. The web UI will use the direct `session.interrupt` WS message via the Stop button instead.

However, the user might also type `/stop` in a non-LM session chat. For that case, the target is the session itself.

- [ ] **Step 1: Update slash command interception in ws-handler to pass `targetSessionId`**

In `packages/server/src/ws-handler.ts`, modify the slash command interception block (around lines 118-143). Replace the `handleSlashCommand` call to include `targetSessionId`:

Find this code block:

```typescript
          if (lmId && data.sessionId === lmId && data.content.trim().startsWith('/')) {
            const result = await handleSlashCommand(data.content.trim(), {
              sessionManager,
              lmSessionId: lmId,
            });
```

Replace with:

```typescript
          if (lmId && data.sessionId === lmId && data.content.trim().startsWith('/')) {
            const result = await handleSlashCommand(data.content.trim(), {
              sessionManager,
              lmSessionId: lmId,
              targetSessionId: undefined, // LM session has no specific target for /stop
            });
```

This makes it explicit that from LM, `/stop` has no target and will show a warning.

- [ ] **Step 2: Also handle `/stop` sent in non-LM sessions**

Slash commands sent in non-LM sessions currently go through as regular messages to the adapter. For `/stop`, we should intercept it. Find the `message.send` case in ws-handler and add interception for `/stop` in non-LM sessions.

After the LM slash command block (after line 145), add before `channelRouter?.setMessageOrigin`:

```typescript
          // Handle /stop in any session (not just LM)
          if (data.content.trim().toLowerCase() === '/stop') {
            await sessionManager.interruptSession(data.sessionId);
            const replyMsg: LobbyMessage = {
              id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              sessionId: data.sessionId,
              timestamp: Date.now(),
              type: 'assistant',
              content: '⏹ 已打断模型回复。',
            };
            send({ type: 'message', sessionId: data.sessionId, message: replyMsg });
            break;
          }
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @openlobby/server build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/ws-handler.ts
git commit -m "feat(server): wire /stop command interception in ws-handler"
```

---

### Task 9: Add `/stop` to IM channel router

**Files:**
- Modify: `packages/server/src/channel-router.ts:383-394`

- [ ] **Step 1: Add `/stop` case to IM slash command dispatch**

In `packages/server/src/channel-router.ts`, in the `handleSlashCommand` method's `switch (cmd)` block (around line 383-394), add a new case after `/exit`:

```typescript
      case '/stop':
        return await this.cmdStop(identityKey);
```

- [ ] **Step 2: Implement `cmdStop` method**

Add the `cmdStop` method after the `cmdExit` method (after line 464):

```typescript
  /** /stop — Interrupt current model generation */
  private async cmdStop(identityKey: string): Promise<string> {
    const binding = getBinding(this.db, identityKey);
    const sessionId = binding?.active_session_id;
    if (!sessionId) {
      return '⚠️ 当前未绑定任何会话。';
    }
    const lmId = this.lobbyManager?.getSessionId();
    if (sessionId === lmId) {
      return '⚠️ Lobby Manager 无法被打断。';
    }
    await this.sessionManager.interruptSession(sessionId);
    return '⏹ 已打断模型回复。';
  }
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @openlobby/server build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/channel-router.ts
git commit -m "feat(channel-router): add /stop command for IM channels"
```

---

### Task 10: Add `wsInterruptSession` helper and Stop button in Web UI

**Files:**
- Modify: `packages/web/src/hooks/useWebSocket.ts:248-250`
- Modify: `packages/web/src/components/MessageInput.tsx:14-18,55-57,360-366`

- [ ] **Step 1: Add `wsInterruptSession()` function**

In `packages/web/src/hooks/useWebSocket.ts`, add after the `wsDestroySession` function (after line 250):

```typescript
export function wsInterruptSession(sessionId: string): void {
  wsSend({ type: 'session.interrupt', sessionId });
}
```

- [ ] **Step 2: Add `sessionId` prop and import `wsInterruptSession` in MessageInput**

In `packages/web/src/components/MessageInput.tsx`, update the imports (line 3):

```typescript
import { wsTogglePlanMode, wsRequestCompletions, wsInterruptSession } from '../hooks/useWebSocket';
```

- [ ] **Step 3: Derive `isRunning` from session status**

In the `MessageInput` component body (after line 57, where `activeSession` is defined), add:

```typescript
  const isRunning = activeSession?.status === 'running' || activeSession?.status === 'awaiting_approval';
```

- [ ] **Step 4: Replace the Send button with a conditional Send/Stop button**

In `packages/web/src/components/MessageInput.tsx`, replace the Send button block (lines 360-366):

From:
```tsx
        <button
          onClick={handleSubmit}
          disabled={disabled || uploading || (!value.trim() && attachments.length === 0)}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600 text-white font-medium text-sm transition-colors"
        >
          {uploading ? '...' : 'Send'}
        </button>
```

To:
```tsx
        {isRunning ? (
          <button
            onClick={() => activeSessionId && wsInterruptSession(activeSessionId)}
            className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium text-sm transition-colors"
          >
            ⏹ Stop
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={disabled || uploading || (!value.trim() && attachments.length === 0)}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600 text-white font-medium text-sm transition-colors"
          >
            {uploading ? '...' : 'Send'}
          </button>
        )}
```

- [ ] **Step 5: Verify build**

Run: `pnpm --filter @openlobby/web build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/hooks/useWebSocket.ts packages/web/src/components/MessageInput.tsx
git commit -m "feat(web): add Stop button and wsInterruptSession helper"
```

---

### Task 11: Full build and smoke test

- [ ] **Step 1: Full monorepo build**

Run: `pnpm -r build`
Expected: PASS — all packages build cleanly.

- [ ] **Step 2: Commit any remaining changes**

If there are type or lint fixes needed, commit them:

```bash
git add -A
git commit -m "fix: address build issues from /stop command implementation"
```
