# IM Session Error Retry Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace auto-fallback-to-LobbyManager on session error/stopped with an in-place retry button, keeping the binding intact so users can resume with one tap.

**Architecture:** Modify two methods in `channel-router.ts`: (1) `handleSessionUpdate` sends a retry button instead of resetting bindings; (2) `handleCallback` handles the new `resume:` callback by delegating to `handleInbound`. The existing `SessionManager.sendMessage` auto-detects dead processes and lazy-resumes, so no SessionManager changes needed.

**Tech Stack:** TypeScript, Fastify, existing `OutboundChannelMessage.actions[]` infrastructure

---

### File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/server/src/channel-router.ts` | Modify | `handleSessionUpdate` (lines 1248-1270): replace binding reset with retry button; `handleCallback` (lines 1527+): add `resume:` handler; `handleInbound` catch block (lines 417-423): add fallback-to-LM on recovery failure |

---

### Task 1: Replace Binding Reset with Retry Button in `handleSessionUpdate`

**Files:**
- Modify: `packages/server/src/channel-router.ts:1248-1270`

- [ ] **Step 1: Modify the error/stopped branch**

Replace the existing block at lines 1248-1270:

```typescript
    // When a session enters error/stopped state, reset bindings that point to it
    // so the user falls back to Lobby Manager on next message
    if (session.status === 'error' || session.status === 'stopped') {
      const bindings = getAllBindingsBySession(this.db, session.id);
      for (const binding of bindings) {
        // Only reset if this was a LM-routed binding (not a manually bound one)
        if (binding.target === 'lobby-manager') {
          updateBindingActiveSession(this.db, binding.identity_key, null);
          this.lastSenderBySession.delete(session.id);
          console.log(`[ChannelRouter] Reset binding ${binding.identity_key} (session ${session.id} → ${session.status})`);

          // Notify user
          const provider = this.providers.get(`${binding.channel_name}:${binding.account_id}`);
          if (provider) {
            provider.sendMessage({
              identity: { channelName: binding.channel_name, accountId: binding.account_id, peerId: binding.peer_id },
              text: `⚠️ 会话异常 (${session.status})，已切换回 Lobby Manager。`,
              kind: 'message',
            }).catch(() => {});
          }
        }
      }
    }
```

With:

```typescript
    // When a session enters error/stopped state, keep binding intact and send retry button
    if (session.status === 'error' || session.status === 'stopped') {
      const bindings = getAllBindingsBySession(this.db, session.id);
      for (const binding of bindings) {
        const provider = this.providers.get(`${binding.channel_name}:${binding.account_id}`);
        if (provider) {
          console.log(`[ChannelRouter] Session ${session.id} → ${session.status}, sending retry button to ${binding.identity_key}`);
          provider.sendMessage({
            identity: { channelName: binding.channel_name, accountId: binding.account_id, peerId: binding.peer_id },
            text: `⚠️ 会话异常 (${session.status})，任务可能已中断。`,
            kind: 'message',
            actions: [{ label: '🔄 重试/继续', callbackData: `resume:${session.id}` }],
          }).catch(() => {});
        }
      }
    }
```

Key changes:
- Removed the `if (binding.target === 'lobby-manager')` filter — now handles all binding types uniformly
- Removed `updateBindingActiveSession(this.db, binding.identity_key, null)` — binding stays intact
- Removed `this.lastSenderBySession.delete(session.id)` — preserved for resume routing
- Added `actions` array with retry button using `resume:<sessionId>` callbackData

- [ ] **Step 2: Verify the change compiles**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm --filter @openlobby/server build`
Expected: Build succeeds with no type errors

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/channel-router.ts
git commit -m "feat: replace IM session error auto-fallback with retry button

Keep binding intact on session error/stopped and send a retry button
instead of resetting to LobbyManager. Applies to all binding types."
```

---

### Task 2: Add `resume:` Callback Handler in `handleCallback`

**Files:**
- Modify: `packages/server/src/channel-router.ts:1527-1581`

- [ ] **Step 1: Add the `resume:` branch before the existing `askq/askt/askc` branch**

Insert the following block right after `const parts = callbackData.split(':');` (line 1529), before the `// ── AskUserQuestion callbacks ──` comment:

```typescript
    // ── Session resume callback ──
    if (parts[0] === 'resume') {
      const sessionId = parts[1];
      if (!sessionId) return;
      console.log(`[ChannelRouter] Resume callback for session ${sessionId} from ${identityKey}`);
      await this.handleInbound({
        identity: { channelName: identity.channelName, accountId: identity.accountId, peerId: identity.peerId },
        text: '继续',
        timestamp: Date.now(),
      });
      return;
    }

```

This delegates to the full `handleInbound` flow, which:
1. Resolves the binding (still intact) to find the error/stopped session
2. Calls `sessionManager.sendMessage(sessionId, "继续")`
3. SessionManager detects dead process → `lazyResume(sessionId, "继续")` re-spawns CLI
4. Or if process is alive, directly sends "继续" to it

- [ ] **Step 2: Verify the change compiles**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm --filter @openlobby/server build`
Expected: Build succeeds with no type errors

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/channel-router.ts
git commit -m "feat: add resume callback handler for IM session retry button

Handle resume:<sessionId> callback by delegating to handleInbound with
'继续' as the message, reusing existing recovery flow."
```

---

### Task 3: Add Fallback-to-LM on Recovery Failure in `handleInbound`

**Files:**
- Modify: `packages/server/src/channel-router.ts:417-423`

- [ ] **Step 1: Enhance the catch block to reset binding when recovery fails**

Replace the existing catch block at lines 417-423:

```typescript
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[ChannelRouter] Failed to route inbound message:`, errMsg);
      // Clear think state on error
      this.streamStates.delete(identityKey);
      await this.sendToChannel(msg.identity, `⚠️ 消息发送失败: ${errMsg}`);
    }
```

With:

```typescript
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[ChannelRouter] Failed to route inbound message:`, errMsg);
      // Clear think state on error
      this.streamStates.delete(identityKey);

      // If recovery failed for an error/stopped session, fall back to LobbyManager
      const session = this.sessionManager.getSessionInfo(sessionId);
      if (session && (session.status === 'error' || session.status === 'stopped')) {
        updateBindingActiveSession(this.db, identityKey, null);
        console.log(`[ChannelRouter] Recovery failed, reset binding ${identityKey} to LobbyManager`);
        await this.sendToChannel(msg.identity, `⚠️ 会话恢复失败，已切换回 Lobby Manager。`);
      } else {
        await this.sendToChannel(msg.identity, `⚠️ 消息发送失败: ${errMsg}`);
      }
    }
```

This ensures that if `lazyResume` fails (adapter missing, spawn error, etc.), the user isn't stuck — the binding gets reset and they fall back to LobbyManager.

- [ ] **Step 2: Verify the change compiles**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm --filter @openlobby/server build`
Expected: Build succeeds with no type errors

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/channel-router.ts
git commit -m "feat: fallback to LobbyManager when session recovery fails

When sendMessage throws for an error/stopped session, reset binding
and notify user instead of showing a generic error."
```

---

### Task 4: Manual Integration Testing

- [ ] **Step 1: Start the dev server**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm --filter @openlobby/server dev`

- [ ] **Step 2: Test the happy path via IM**

1. Start a session via IM
2. Force the session to error (kill the CLI process or trigger an error)
3. Verify: IM shows `⚠️ 会话异常 (error)，任务可能已中断。` with a `🔄 重试/继续` button
4. Click the button
5. Verify: session resumes and responds

- [ ] **Step 3: Test custom message recovery**

1. Force session error again
2. Instead of clicking the button, send a new message like "帮我检查代码"
3. Verify: session resumes with the new message as prompt

- [ ] **Step 4: Verify no regression on normal flow**

1. Send messages to a healthy session — should work as before
2. Approval buttons should still work
3. `/exit` should still work

- [ ] **Step 5: Full build check**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm -r build`
Expected: All packages build successfully
