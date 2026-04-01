# Compact Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface compact status/results to users, add a UI compact button, and auto-prompt when token usage is high.

**Architecture:** Each adapter converts its native compact events into unified LobbyMessages. SessionManager accumulates per-session token usage from `result` messages and emits a compact suggestion when the threshold is crossed. The frontend renders compact-related system messages and provides a toolbar button. IM channels receive notifications via ChannelRouter.

**Tech Stack:** TypeScript, Vitest, React, Tailwind, WebSocket, SQLite

---

### Task 1: Add Token Tracking to ManagedSession

**Files:**
- Modify: `packages/server/src/session-manager.ts:27-44` (ManagedSession type)
- Modify: `packages/server/src/session-manager.ts:288-363` (wireProcessEvents)

- [ ] **Step 1: Add tokenUsage fields to ManagedSession**

In `packages/server/src/session-manager.ts`, extend the `ManagedSession` interface:

```typescript
export interface ManagedSession {
  // ... existing fields (id, previousIds, adapterName, etc.) ...
  messageMode: MessageMode;
  /** Cumulative token usage for compact threshold tracking */
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    compactCount: number;
    /** Suppress repeated compact prompts until next compact/reset */
    compactPrompted: boolean;
  };
}
```

- [ ] **Step 2: Initialize tokenUsage in createSession and resumeSession**

In `createSession()` (~line 399), add the default `tokenUsage` to the session object:

```typescript
const session: ManagedSession = {
  // ... existing fields ...
  messageMode: /* existing logic */,
  tokenUsage: {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    compactCount: 0,
    compactPrompted: false,
  },
};
```

Apply the same initialization in `resumeSession()` (~line 438) and `lazyResume()`.

- [ ] **Step 3: Accumulate token usage in wireProcessEvents**

In `wireProcessEvents()`, inside the `process.on('message', ...)` handler (~line 316), after the existing message cache and broadcast logic, add token accumulation:

```typescript
// Accumulate token usage from result messages
if (msg.type === 'result' && msg.meta?.tokenUsage) {
  const tu = msg.meta.tokenUsage as { input: number; output: number };
  session.tokenUsage.inputTokens += tu.input;
  session.tokenUsage.outputTokens += tu.output;
  session.tokenUsage.totalTokens += tu.input + tu.output;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/session-manager.ts
git commit -m "feat(compact): add per-session token usage accumulation"
```

---

### Task 2: Compact Threshold Auto-Prompt

**Files:**
- Modify: `packages/server/src/session-manager.ts` (wireProcessEvents, new helper)
- Modify: `packages/server/src/db.ts` (if needed for getServerConfig — already exists)

- [ ] **Step 1: Add compact threshold check after token accumulation**

In `wireProcessEvents()`, right after the token accumulation code added in Task 1, add the threshold check:

```typescript
// Check compact threshold
if (msg.type === 'result' && msg.meta?.tokenUsage) {
  // ... token accumulation from Task 1 ...

  const threshold = this.db
    ? parseInt(getServerConfig(this.db, 'compactThreshold') ?? '150000', 10)
    : 150000;

  if (
    session.tokenUsage.totalTokens >= threshold &&
    !session.tokenUsage.compactPrompted
  ) {
    session.tokenUsage.compactPrompted = true;
    const suggestionMsg = makeLobbyMessage(session.id, 'system', {
      compactSuggestion: true,
      currentTokens: session.tokenUsage.totalTokens,
      threshold,
    });
    this.broadcastMessage(session.id, suggestionMsg);
    // IM notification handled in Task 6
    this.emit('compactSuggestion', session);
  }
}
```

Import `makeLobbyMessage` from `@openlobby/core` at the top of session-manager.ts if not already imported.

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/session-manager.ts
git commit -m "feat(compact): auto-prompt when token usage exceeds threshold"
```

---

### Task 3: Claude Code Compact Event Conversion

**Files:**
- Modify: `packages/core/src/adapters/claude-code.ts:49-127` (sdkMessageToLobby function)

- [ ] **Step 1: Handle compact_boundary in sdkMessageToLobby**

In the `sdkMessageToLobby` function, add a case for `compact_boundary` system messages. Insert before the default `system` handling:

```typescript
// Compact boundary — emitted when compaction completes
if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
  const metadata = msg.compact_metadata as { trigger: string; pre_tokens: number } | undefined;
  messages.push(
    makeLobbyMessage(sessionId, 'system', {
      compact: true,
      trigger: metadata?.trigger ?? 'manual',
      preTokens: metadata?.pre_tokens ?? 0,
    }),
  );
  return messages;
}
```

- [ ] **Step 2: Handle compacting status in sdkMessageToLobby**

Add handling for the `status` subtype that signals compacting is in progress:

```typescript
// Compacting status — emitted while compact is running
if (msg.type === 'system' && msg.subtype === 'status' && msg.status === 'compacting') {
  messages.push(
    makeLobbyMessage(sessionId, 'system', {
      compacting: true,
    }),
  );
  return messages;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/adapters/claude-code.ts
git commit -m "feat(compact): convert Claude Code compact events to LobbyMessage"
```

---

### Task 4: OpenCode Compact Event Conversion

**Files:**
- Modify: `packages/core/src/adapters/opencode.ts:210-228` (handlePartUpdated default case)

- [ ] **Step 1: Handle session.compacted SSE event**

In the OpenCode adapter's SSE event handler, the `compaction` part type is currently ignored at line 224. Add handling for it before the `default: break`:

Find the `handlePartUpdated` method or the switch/if block that handles part types. Look for where `compaction` is mentioned in the ignored comment. Add a case for the compaction event type. The exact location depends on how events arrive — it may be in `handlePartUpdated` or a separate SSE event handler.

In the SSE event subscription (where events like `part.updated`, `message.updated` are handled), add a handler for `session.compacted`:

```typescript
// In the SSE event subscription setup, add:
events.on('session.compacted', (data: unknown) => {
  const event = data as { sessionID?: string; tokens?: number };
  if (event.sessionID && event.sessionID !== proc.sessionId) return;
  proc.emit('message', makeLobbyMessage(proc.sessionId, 'system', {
    compact: true,
    trigger: 'manual',
    preTokens: event.tokens ?? 0,
  }));
});
```

If the `session.compacted` event doesn't arrive as a top-level SSE event but as a part type in `handlePartUpdated`, handle it there instead:

```typescript
case 'compaction':
  this.emit('message', makeLobbyMessage(this.sessionId, 'system', {
    compact: true,
    trigger: 'manual',
    preTokens: 0,
  }));
  break;
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/adapters/opencode.ts
git commit -m "feat(compact): convert OpenCode compaction events to LobbyMessage"
```

---

### Task 5: Reset Token Counters on Compact

**Files:**
- Modify: `packages/server/src/session-manager.ts` (wireProcessEvents)

- [ ] **Step 1: Detect compact system messages and reset counters**

In `wireProcessEvents()`, inside the `process.on('message', ...)` handler, add compact detection before the token accumulation logic:

```typescript
// Reset token counters on compact completion
if (
  msg.type === 'system' &&
  typeof msg.content === 'object' &&
  msg.content !== null &&
  (msg.content as Record<string, unknown>).compact === true
) {
  session.tokenUsage.inputTokens = 0;
  session.tokenUsage.outputTokens = 0;
  session.tokenUsage.totalTokens = 0;
  session.tokenUsage.compactCount += 1;
  session.tokenUsage.compactPrompted = false;
  // Notify IM about compact completion (Task 6)
  this.emit('compactComplete', session, msg.content);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/session-manager.ts
git commit -m "feat(compact): reset token counters on compact completion"
```

---

### Task 6: WebSocket Compact Action

**Files:**
- Modify: `packages/server/src/ws-handler.ts:130-225` (message handling)

- [ ] **Step 1: Add compact message type handler**

In `ws-handler.ts`, inside the `switch (data.type)` block where `send`, `control.respond`, etc. are handled, add a new case:

```typescript
case 'compact': {
  const compactSessionId = data.sessionId as string;
  const instructions = (data as { instructions?: string }).instructions ?? '';
  const compactCmd = '/compact' + (instructions ? ' ' + instructions : '');
  await sessionManager.sendMessage(compactSessionId, compactCmd);
  break;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/ws-handler.ts
git commit -m "feat(compact): handle compact WebSocket action"
```

---

### Task 7: IM Channel Notifications

**Files:**
- Modify: `packages/server/src/channel-router.ts` (result handling area, ~lines 810-870)

- [ ] **Step 1: Listen for compactSuggestion and compactComplete events**

In the ChannelRouter constructor or initialization, after existing event subscriptions on SessionManager, subscribe to the new events:

```typescript
// In ChannelRouter initialization (where sessionManager events are wired):
sessionManager.on('compactSuggestion', (session: ManagedSession) => {
  const binding = this.findBindingForSession(session.id);
  if (!binding) return;
  const tokens = session.tokenUsage.totalTokens;
  const tokensK = Math.round(tokens / 1000);
  const text = `⚠️ Session "${session.displayName}" context approaching limit (${tokensK}K tokens).\nReply /compact to compress, or /compact <instructions> with custom guidance.`;
  this.sendToChannel(binding.identity, text);
});

sessionManager.on('compactComplete', (session: ManagedSession, content: Record<string, unknown>) => {
  const binding = this.findBindingForSession(session.id);
  if (!binding) return;
  const preTokens = content.preTokens as number | undefined;
  const preK = preTokens ? Math.round(preTokens / 1000) : null;
  const text = preK
    ? `✂️ Session "${session.displayName}" compacted. (was ${preK}K tokens)`
    : `✂️ Session "${session.displayName}" compacted.`;
  this.sendToChannel(binding.identity, text);
});
```

Note: `findBindingForSession` is a helper to look up the IM channel binding for a session. If it doesn't exist, find the equivalent method that maps session IDs to channel identities. It may be named differently — check the existing code for how result messages find their channel binding.

- [ ] **Step 2: Add event type declarations**

If SessionManager extends EventEmitter, the events are dynamically typed. If it uses typed events, add the new event signatures. Otherwise, just ensure the `emit` calls in Task 2 and Task 5 match the `on` subscriptions here.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/channel-router.ts
git commit -m "feat(compact): send compact notifications to IM channels"
```

---

### Task 8: Frontend — Compact System Messages

**Files:**
- Modify: `packages/web/src/components/MessageBubble.tsx:200-330`

- [ ] **Step 1: Add CompactContent component**

Add a new component in `MessageBubble.tsx` for rendering compact-related system messages:

```tsx
function CompactContent({ msg }: { msg: LobbyMessageData }) {
  const content = typeof msg.content === 'object' ? msg.content as Record<string, unknown> : {};

  // Compact suggestion
  if (content.compactSuggestion) {
    const tokensK = Math.round((content.currentTokens as number) / 1000);
    return (
      <div className="flex items-center gap-2 text-xs text-yellow-400">
        <span>⚠️ Context approaching limit ({tokensK}K tokens).</span>
        <button
          onClick={() => {
            // Send compact WebSocket message
            const ws = (window as any).__openlobby_ws;
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'compact', sessionId: msg.sessionId }));
            }
          }}
          className="px-2 py-0.5 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 rounded text-xs transition-colors"
        >
          Compact Now
        </button>
      </div>
    );
  }

  // Compacting in progress
  if (content.compacting) {
    return (
      <div className="flex items-center gap-2 text-xs text-blue-400">
        <span className="animate-pulse">✂️ Compacting conversation...</span>
      </div>
    );
  }

  // Compact complete
  if (content.compact) {
    const preTokens = content.preTokens as number | undefined;
    const preK = preTokens ? Math.round(preTokens / 1000) : null;
    return (
      <div className="flex items-center gap-2 text-xs text-green-400">
        <span>✂️ Conversation compacted{preK ? ` (was ${preK}K tokens)` : ''}</span>
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 2: Integrate into the message rendering logic**

In the main `MessageBubble` component, where system messages are rendered (look for the `isSystem` or `msg.type === 'system'` check), add compact detection before the default system rendering:

```tsx
// Compact system messages: centered bar (like result messages)
if (msg.type === 'system' && typeof msg.content === 'object') {
  const c = msg.content as Record<string, unknown>;
  if (c.compactSuggestion || c.compacting || c.compact) {
    return (
      <div className="flex justify-center py-1">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-full px-4 py-1">
          <CompactContent msg={msg} />
        </div>
      </div>
    );
  }
}
```

- [ ] **Step 3: Check how the WebSocket instance is accessed**

The `CompactContent` button needs to send a WebSocket message. Check how the frontend accesses the WebSocket — it might be stored in a React context, a global, or a store. Adjust the `onClick` handler to use the correct access pattern. For example, if there's a `useWebSocket` hook or a `sendWsMessage` function, use that instead of `(window as any).__openlobby_ws`.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/MessageBubble.tsx
git commit -m "feat(compact): render compact system messages in chat"
```

---

### Task 9: Frontend — Compact Button in Session Header

**Files:**
- Modify: `packages/web/src/components/RoomHeader.tsx` (session header toolbar)

- [ ] **Step 1: Add compact button to the header toolbar**

In `RoomHeader.tsx`, find the toolbar area where action buttons are rendered (near the Settings button). Add a compact button:

```tsx
{/* Compact button — shown only when adapter supports /compact */}
<button
  onClick={() => {
    // Send compact via WebSocket (same pattern as CompactContent button)
    sendWsMessage({ type: 'compact', sessionId: activeSessionId });
  }}
  title="Compact conversation"
  className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
>
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414L8.586 5H4a1 1 0 110-2h7a1 1 0 011 1v7a1 1 0 11-2 0V6.414l-3.293 3.293a1 1 0 01-1.414 0zM14.707 10.293a1 1 0 010 1.414L11.414 15H16a1 1 0 110 2H9a1 1 0 01-1-1v-7a1 1 0 112 0v4.586l3.293-3.293a1 1 0 011.414 0z" clipRule="evenodd" />
  </svg>
</button>
```

The icon represents "compress/compact" (inward arrows). Adjust to match the existing icon style in the toolbar.

- [ ] **Step 2: Conditionally show based on adapter commands**

If the session's adapter commands are available (cached from the `commands` event), only show the button if `/compact` is in the command list. If commands aren't available, show the button for `claude-code` and `opencode` adapters, hide for `codex-cli`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/RoomHeader.tsx
git commit -m "feat(compact): add compact button to session header toolbar"
```

---

### Task 10: Build Verification & Integration Test

**Files:**
- All modified files

- [ ] **Step 1: Build all packages**

```bash
pnpm -r build
```

Expected: All packages build without errors.

- [ ] **Step 2: Verify frontend build**

```bash
pnpm --filter @openlobby/web build
```

Expected: Vite build completes successfully.

- [ ] **Step 3: Verify CLI bundle**

```bash
pnpm build:cli
```

Expected: esbuild bundle completes, outputs `dist/bin.js`.

- [ ] **Step 4: Commit any build fixes**

If any build errors occurred, fix them and commit:

```bash
git add -A
git commit -m "fix(compact): resolve build issues"
```
