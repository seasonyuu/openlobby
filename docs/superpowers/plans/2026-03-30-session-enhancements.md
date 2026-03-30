# Session Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/new` command (CLI rebuild), message modes (`msg-only`/`msg-tidy`/`msg-total`), and default adapter switching with LM rebuild.

**Architecture:** Three independent features built on the existing slash-command, session-manager, and protocol infrastructure. Message modes add server-side filtering with `msg-tidy` aggregation handled separately in Web (Zustand store) and IM (ChannelRouter StreamState). Default adapter uses a new `server_config` SQLite table with protocol messages for read/write.

**Tech Stack:** TypeScript, Fastify, WebSocket, SQLite (better-sqlite3), React + Zustand + Tailwind

---

## File Map

### New files
- `packages/web/src/components/ToolSummaryBubble.tsx` — Renders live/final tool call summary for `msg-tidy` mode
- `packages/web/src/components/GlobalSettings.tsx` — Global settings panel (default adapter, default message mode)

### Modified files
- `packages/core/src/types.ts` — Add `messageMode` to `SessionSummary`; add `MessageMode` type
- `packages/core/src/protocol.ts` — Add `config.get`, `config.set`, `config.value` protocol messages; extend `session.configure`
- `packages/server/src/db.ts` — Add `server_config` table; add `message_mode` column migration; add get/set config helpers
- `packages/server/src/session-manager.ts` — Add `messageMode` to `ManagedSession`; add `rebuildSession()` method; extend `configureSession()` for `messageMode`; add message filtering in `broadcastMessage()`
- `packages/server/src/slash-commands.ts` — Add `/new`, `/msg-only`, `/msg-tidy`, `/msg-total` handlers
- `packages/server/src/lobby-manager.ts` — Accept adapter name in `init()`; add `rebuild()` method
- `packages/server/src/ws-handler.ts` — Handle `config.get`/`config.set`; intercept `/new` and `/msg-*` commands in work sessions; pass `messageMode` through message filtering
- `packages/server/src/channel-router.ts` — Add `msg-tidy` aggregation state; filter messages per mode; send final statistics
- `packages/server/src/index.ts` — Pass `db` to `LobbyManager` for reading `defaultAdapter` from `server_config`
- `packages/web/src/stores/lobby-store.ts` — Add `messageMode` to `SessionSummaryData`; add `toolCallAggregator` state; add `serverConfig` state
- `packages/web/src/hooks/useWebSocket.ts` — Handle `config.value` messages; add `wsGetConfig`/`wsSetConfig` helpers
- `packages/web/src/components/RoomHeader.tsx` — Add message mode dropdown in settings panel
- `packages/web/src/components/NewSessionDialog.tsx` — Default adapter from global config; add message mode selector
- `packages/web/src/components/Sidebar.tsx` — Add global settings button
- `packages/web/src/components/MessageList.tsx` — Render `ToolSummaryBubble` for `msg-tidy` aggregated messages

---

## Task 1: Database Schema — `server_config` Table + `message_mode` Column

**Files:**
- Modify: `packages/server/src/db.ts`

- [ ] **Step 1: Add `server_config` table and helpers to db.ts**

In `packages/server/src/db.ts`, add the new table creation inside `initDb()` (after the `adapter_plugins` table), add the `message_mode` column migration, and add the helper functions:

```typescript
// Inside initDb(), after the adapter_plugins table creation:

  db.exec(`
    CREATE TABLE IF NOT EXISTS server_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Migration: add message_mode column if not exists
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN message_mode TEXT DEFAULT 'msg-tidy'`);
  } catch {
    // Column already exists — ignore
  }
```

Add the following exports at the bottom of `db.ts`, before the closing of the file:

```typescript
// ─── Server Config ──────────────────────────────────────────────────

export function getServerConfig(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM server_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setServerConfig(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)').run(key, value);
}
```

Also update `SessionRow` interface to include `message_mode`:

```typescript
export interface SessionRow {
  // ... existing fields ...
  message_mode: string | null;
}
```

And update the `upsertSession` query to include `message_mode`:

```sql
INSERT OR REPLACE INTO sessions
  (id, adapter_name, display_name, cwd, jsonl_path, origin, status, created_at, last_active_at, model, tags, permission_mode, message_mode)
VALUES
  (@id, @adapter_name, @display_name, @cwd, @jsonl_path, @origin, @status, @created_at, @last_active_at, @model, @tags, @permission_mode, @message_mode)
```

- [ ] **Step 2: Verify the server starts without errors**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm --filter @openlobby/server dev`
Expected: Server starts without SQLite errors. Check logs for successful table creation.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/db.ts
git commit -m "feat(db): add server_config table and message_mode column"
```

---

## Task 2: Core Types — `MessageMode` Type + Protocol Messages

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/protocol.ts`

- [ ] **Step 1: Add MessageMode type and update SessionSummary in types.ts**

In `packages/core/src/types.ts`, add before the `SessionSummary` interface:

```typescript
export type MessageMode = 'msg-total' | 'msg-tidy' | 'msg-only';
```

Add `messageMode` to `SessionSummary`:

```typescript
export interface SessionSummary {
  // ... existing fields ...
  messageMode?: MessageMode;
}
```

- [ ] **Step 2: Add config protocol messages in protocol.ts**

In `packages/core/src/protocol.ts`, add to the `ClientMessage` union:

```typescript
  | { type: 'config.get'; key: string }
  | { type: 'config.set'; key: string; value: string }
```

Add to the `ServerMessage` union:

```typescript
  | { type: 'config.value'; key: string; value: string }
```

- [ ] **Step 3: Build core package to verify types compile**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm --filter @openlobby/core build`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/protocol.ts
git commit -m "feat(core): add MessageMode type and config protocol messages"
```

---

## Task 3: SessionManager — `messageMode` Field + `rebuildSession()` + Message Filtering

**Files:**
- Modify: `packages/server/src/session-manager.ts`

- [ ] **Step 1: Add `messageMode` to `ManagedSession` and update related methods**

In `packages/server/src/session-manager.ts`:

1. Add import at the top:
```typescript
import type { MessageMode } from '@openlobby/core';
```

2. Add `messageMode` to `ManagedSession`:
```typescript
export interface ManagedSession {
  // ... existing fields ...
  messageMode: MessageMode;
}
```

3. Update `toSummary()` to include `messageMode`:
```typescript
private toSummary(s: ManagedSession): SessionSummary {
  // ... existing code ...
  return {
    // ... existing fields ...
    messageMode: s.messageMode,
  };
}
```

4. Update `persistSession()` to include `message_mode`:
```typescript
private persistSession(session: ManagedSession): void {
  if (!this.db) return;
  upsertSession(this.db, {
    // ... existing fields ...
    message_mode: session.messageMode,
  });
}
```

5. Update `createSession()` — set default `messageMode`:
```typescript
// Add import at top:
import { getServerConfig } from './db.js';

// In createSession(), when building the session object:
const session: ManagedSession = {
  // ... existing fields ...
  messageMode: (options as any).messageMode ?? (this.db ? (getServerConfig(this.db, 'defaultMessageMode') as MessageMode | undefined) : undefined) ?? 'msg-tidy',
};
```

6. Update `resumeSession()` — read `messageMode` from options or default:
```typescript
const session: ManagedSession = {
  // ... existing fields ...
  messageMode: (options as any).messageMode ?? 'msg-tidy',
};
```

7. Update `lazyResume()` — read `message_mode` from DB row:
```typescript
const session: ManagedSession = {
  // ... existing fields ...
  messageMode: (row.message_mode as MessageMode) ?? 'msg-tidy',
};
```

8. Update `listSessions()` — include `messageMode` in SQLite-only sessions:
```typescript
result.push({
  // ... existing fields ...
  messageMode: (row.message_mode as MessageMode) ?? 'msg-tidy',
});
```

9. Update `getSessionInfo()` — include `messageMode`:
```typescript
return {
  // ... existing fields ...
  messageMode: (row.message_mode as MessageMode) ?? 'msg-tidy',
};
```

10. Update `configureSession()` — handle `messageMode`:
```typescript
configureSession(sessionId: string, options: Partial<SpawnOptions> & { messageMode?: MessageMode }): void {
  const session = this.sessions.get(sessionId);
  if (!session) throw new Error(`Session "${sessionId}" not found`);
  session.process.updateOptions(options);
  if (options.model) session.model = options.model;
  if (options.permissionMode) session.permissionMode = options.permissionMode;
  if (options.messageMode) session.messageMode = options.messageMode;
  this.persistSession(session);
  this.broadcastSessionUpdate(session);
}
```

- [ ] **Step 2: Add `rebuildSession()` method**

Add to `SessionManager` class:

```typescript
/**
 * Rebuild the underlying CLI session without changing the lobby session identity.
 * Stops the current process and spawns a new one with the same config.
 */
async rebuildSession(sessionId: string): Promise<void> {
  const session = this.sessions.get(sessionId);
  if (!session) throw new Error(`Session "${sessionId}" not found`);

  const adapter = this.adapters.get(session.adapterName);
  if (!adapter) throw new Error(`Adapter "${session.adapterName}" not found`);

  // Read current spawn options from the process
  const currentOpts = (session.process as unknown as { spawnOptions?: SpawnOptions })?.spawnOptions;
  const spawnOptions: SpawnOptions = {
    cwd: session.cwd,
    model: session.model,
    permissionMode: session.permissionMode,
    ...(currentOpts ? {
      systemPrompt: currentOpts.systemPrompt,
      allowedTools: currentOpts.allowedTools,
      mcpServers: currentOpts.mcpServers,
      apiKey: currentOpts.apiKey,
    } : {}),
  };

  // Stop existing process (graceful, not destroy)
  try {
    session.process.kill();
  } catch {
    // Process may already be dead
  }

  // Spawn new process with same config
  const newProcess = await adapter.spawn(spawnOptions);

  // Replace process reference
  session.process = newProcess;
  session.status = 'running';
  session.lastActiveAt = Date.now();

  // Re-wire events
  this.wireProcessEvents(session);
  this.persistSessionStatus(session);

  // Broadcast system message
  const sysMsg: LobbyMessage = {
    id: `rebuild-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: session.id,
    timestamp: Date.now(),
    type: 'system',
    content: 'CLI session rebuilt',
  };
  this.broadcastMessage(session.id, sysMsg);
  this.broadcastSessionUpdate(session);
}
```

- [ ] **Step 3: Add message filtering to `broadcastMessage()`**

Update `broadcastMessage()` to support mode-aware filtering. The filtering is per-listener based on the session's messageMode. However, since the broadcastMessage doesn't know which listener handles web vs IM, the filtering should happen at the point of broadcast:

```typescript
private broadcastMessage(sessionId: string, msg: LobbyMessage): void {
  // Get session's message mode for filtering
  const session = this.sessions.get(sessionId);
  const mode = session?.messageMode ?? 'msg-total';

  // Apply mode-based filtering
  if (mode === 'msg-only') {
    // Suppress tool_use and tool_result, always pass control
    if (msg.type === 'tool_use' || msg.type === 'tool_result') {
      if (msg.type !== 'control') return; // control always passes
      return; // tool_use/tool_result suppressed
    }
  }
  // msg-tidy filtering is handled by listeners (web store and channel-router)
  // because they need stateful aggregation. We still broadcast the raw messages
  // but mark the session mode so listeners can decide.

  for (const handler of this.messageListeners.values()) {
    handler(sessionId, msg);
  }
}
```

Wait — actually the control type is separate from tool_use/tool_result. Control is always type 'control'. Let me fix:

```typescript
private broadcastMessage(sessionId: string, msg: LobbyMessage): void {
  const session = this.sessions.get(sessionId);
  const mode = session?.messageMode ?? 'msg-total';

  if (mode === 'msg-only' && (msg.type === 'tool_use' || msg.type === 'tool_result')) {
    return; // Suppress tool messages in msg-only mode (control always passes through)
  }

  for (const handler of this.messageListeners.values()) {
    handler(sessionId, msg);
  }
}
```

- [ ] **Step 4: Add `getSessionMode()` public method for listeners**

```typescript
getSessionMode(sessionId: string): MessageMode {
  const session = this.sessions.get(sessionId);
  return session?.messageMode ?? 'msg-total';
}
```

- [ ] **Step 5: Build server package to verify compilation**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm --filter @openlobby/server build`
Expected: Compilation succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/session-manager.ts
git commit -m "feat(session-manager): add messageMode, rebuildSession(), and message filtering"
```

---

## Task 4: Slash Commands — `/new`, `/msg-only`, `/msg-tidy`, `/msg-total`

**Files:**
- Modify: `packages/server/src/slash-commands.ts`

- [ ] **Step 1: Add new slash commands**

In `packages/server/src/slash-commands.ts`:

1. Add import:
```typescript
import type { MessageMode } from '@openlobby/core';
```

2. Add `rebuildSessionId` to `SlashCommandResult`:
```typescript
export interface SlashCommandResult {
  text: string;
  createdSessionId?: string;
  navigateSessionId?: string;
  destroyedSessionId?: string;
  /** If the command rebuilt the CLI session */
  rebuiltSessionId?: string;
  /** If the command changed message mode */
  configuredSessionId?: string;
}
```

3. Add cases to the switch in `handleSlashCommand()`:
```typescript
    case '/new':
      return null; // Needs session context — handled by caller (ws-handler / channel-router)
    case '/msg-only':
    case '/msg-tidy':
    case '/msg-total':
      return null; // Needs session context — handled by caller
```

4. Update `/help` to include new commands:
```typescript
function cmdHelp(): SlashCommandResult {
  return {
    text: [
      '📋 **OpenLobby 快捷命令**',
      '',
      '`/help` — 显示此帮助信息',
      '`/ls` — 列出所有会话',
      '`/add [name]` — 创建新会话',
      '`/goto <id|name>` — 切换到指定会话',
      '`/exit` — 返回 Lobby Manager',
      '`/stop` — 打断当前模型回复',
      '`/rm <id|name>` — 销毁指定会话',
      '`/info` — 查看当前会话信息',
      '`/new` — 重建当前会话的 CLI 进程',
      '`/msg-only` — 仅推送回复内容',
      '`/msg-tidy` — 工具调用折叠为摘要',
      '`/msg-total` — 推送全部消息',
      '`/bind <sessionId>` — 绑定到指定会话 (IM)',
      '`/unbind` — 解绑当前会话 (IM)',
    ].join('\n'),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/slash-commands.ts
git commit -m "feat(slash-commands): add /new, /msg-only, /msg-tidy, /msg-total stubs and help text"
```

---

## Task 5: WebSocket Handler — `/new` and `/msg-*` Handling + Config Messages

**Files:**
- Modify: `packages/server/src/ws-handler.ts`

- [ ] **Step 1: Add `/new` and `/msg-*` command interception in ws-handler.ts**

In `packages/server/src/ws-handler.ts`, update the `message.send` case to handle `/new` and `/msg-*` for ALL sessions (not just LM):

After the existing `/stop` interception block (around line 148-159), add:

```typescript
          // Handle /new in any session — rebuild CLI process
          if (data.content.trim().toLowerCase() === '/new') {
            try {
              await sessionManager.rebuildSession(data.sessionId);
              // rebuildSession broadcasts a system message internally
            } catch (err) {
              const replyMsg: LobbyMessage = {
                id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                sessionId: data.sessionId,
                timestamp: Date.now(),
                type: 'system',
                content: `⚠️ 重建 CLI 会话失败: ${err instanceof Error ? err.message : String(err)}`,
              };
              send({ type: 'message', sessionId: data.sessionId, message: replyMsg });
            }
            break;
          }

          // Handle /msg-* in any session — switch message mode
          const msgModeMatch = data.content.trim().toLowerCase().match(/^\/msg-(only|tidy|total)$/);
          if (msgModeMatch) {
            const mode = `msg-${msgModeMatch[1]}` as import('@openlobby/core').MessageMode;
            try {
              sessionManager.configureSession(data.sessionId, { messageMode: mode } as any);
              const replyMsg: LobbyMessage = {
                id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                sessionId: data.sessionId,
                timestamp: Date.now(),
                type: 'system',
                content: `✅ 消息模式已切换为 \`${mode}\``,
              };
              send({ type: 'message', sessionId: data.sessionId, message: replyMsg });
            } catch (err) {
              send({ type: 'error', sessionId: data.sessionId, error: String(err) });
            }
            break;
          }
```

- [ ] **Step 2: Add `config.get` and `config.set` message handlers**

In the switch block of `socket.on('message')`, add new cases:

```typescript
        case 'config.get': {
          const { getServerConfig } = await import('./db.js');
          const db = (sessionManager as any).db as import('better-sqlite3').Database | null;
          if (db) {
            const value = getServerConfig(db, (data as any).key) ?? '';
            send({ type: 'config.value', key: (data as any).key, value } as any);
          }
          break;
        }

        case 'config.set': {
          const { setServerConfig, getServerConfig: getConfig } = await import('./db.js');
          const configDb = (sessionManager as any).db as import('better-sqlite3').Database | null;
          const key = (data as any).key as string;
          const value = (data as any).value as string;

          if (configDb) {
            setServerConfig(configDb, key, value);
            send({ type: 'config.value', key, value } as any);

            // Special handling: if defaultAdapter changed, rebuild LobbyManager
            if (key === 'defaultAdapter' && lobbyManager) {
              try {
                lobbyManager.destroy();
                await lobbyManager.init(value);
                send({
                  type: 'lm.status',
                  available: lobbyManager.isAvailable(),
                  sessionId: lobbyManager.getSessionId() ?? undefined,
                });
              } catch (err) {
                send({ type: 'error', error: `LM rebuild failed: ${err instanceof Error ? err.message : String(err)}` });
              }
            }
          }
          break;
        }
```

- [ ] **Step 3: Build and verify**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm --filter @openlobby/server build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/ws-handler.ts
git commit -m "feat(ws-handler): handle /new, /msg-* commands and config.get/set protocol"
```

---

## Task 6: LobbyManager — Accept Adapter Name + Rebuild

**Files:**
- Modify: `packages/server/src/lobby-manager.ts`

- [ ] **Step 1: Update `init()` to accept optional adapter name**

In `packages/server/src/lobby-manager.ts`:

1. Add import:
```typescript
import { getServerConfig } from './db.js';
```

2. Update `init()` signature and logic:

```typescript
async init(preferredAdapter?: string): Promise<void> {
  // Read default adapter from server_config if not specified
  const configAdapter = preferredAdapter ?? (this.db ? getServerConfig(this.db, 'defaultAdapter') : undefined);

  // Build dynamic priority: prefer configured adapter, then claude-code, then others
  const adapterPriority = configAdapter
    ? [configAdapter, ...Array.from(this.adapters.keys()).filter((n) => n !== configAdapter)]
    : ['claude-code', ...Array.from(this.adapters.keys()).filter((n) => n !== 'claude-code')];

  // ... rest of init() unchanged (uses adapterPriority) ...
```

3. Add `rebuild()` method:

```typescript
/**
 * Destroy the current LM session and recreate with a new adapter.
 * Called when defaultAdapter config changes.
 */
async rebuild(newAdapterName: string): Promise<void> {
  this.destroy();
  this.available = false;
  this.adapterName = null;
  this.sessionId = null;

  // Remove the listener for session ID sync before re-init
  this.sessionManager.removeSessionUpdateListener('lm-id-sync');

  await this.init(newAdapterName);
}
```

- [ ] **Step 2: Update ws-handler to use `rebuild()` instead of manual destroy+init**

In `packages/server/src/ws-handler.ts`, update the `config.set` handler's `defaultAdapter` special case:

```typescript
            if (key === 'defaultAdapter' && lobbyManager) {
              try {
                await lobbyManager.rebuild(value);
                send({
                  type: 'lm.status',
                  available: lobbyManager.isAvailable(),
                  sessionId: lobbyManager.getSessionId() ?? undefined,
                });
              } catch (err) {
                send({ type: 'error', error: `LM rebuild failed: ${err instanceof Error ? err.message : String(err)}` });
              }
            }
```

- [ ] **Step 3: Build and verify**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm --filter @openlobby/server build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/lobby-manager.ts packages/server/src/ws-handler.ts
git commit -m "feat(lobby-manager): support adapter selection and rebuild on config change"
```

---

## Task 7: ChannelRouter — Message Mode Filtering + `msg-tidy` Aggregation

**Files:**
- Modify: `packages/server/src/channel-router.ts`

- [ ] **Step 1: Add tool call aggregation state and filtering**

In `packages/server/src/channel-router.ts`:

1. Add import:
```typescript
import type { MessageMode } from '@openlobby/core';
```

2. Add a per-identity tool call aggregation state interface (near the `StreamState` interface):

```typescript
/** Per-identity tool call aggregation for msg-tidy mode */
interface ToolAggregateState {
  toolCounts: Record<string, number>;
  lastToolName: string;
  lastToolContent: string;
  totalCalls: number;
}
```

3. Add a Map to `ChannelRouterImpl`:

```typescript
  /** Per-identity tool aggregation for msg-tidy mode */
  private toolAggregates = new Map<string, ToolAggregateState>();
```

4. Update `handleSessionMessage()` to check message mode. At the very beginning of the method, after resolving `origin` and before the source-aware routing:

```typescript
  private handleSessionMessage(sessionId: string, msg: LobbyMessage): void {
    const origin = this.messageOriginBySession.get(sessionId);

    if (msg.type === 'result') {
      this.messageOriginBySession.delete(sessionId);
    }

    if (origin === 'web' && msg.type !== 'control') {
      return;
    }

    if (msg.type === 'control' && origin === 'web') {
      this.routeApprovalToIM(sessionId, msg);
      return;
    }

    // Get message mode for this session
    const messageMode = this.sessionManager.getSessionMode(sessionId);

    // msg-only: suppress tool_use and tool_result (control always passes)
    if (messageMode === 'msg-only' && (msg.type === 'tool_use' || msg.type === 'tool_result')) {
      return;
    }

    const bindingRow = this.resolveResponseBinding(sessionId);
    // ... existing binding resolution code ...
```

5. In the `switch (msg.type)` block, wrap `tool_use` and `tool_result` cases with msg-tidy handling:

For the `tool_use` case, add at the beginning:
```typescript
      case 'tool_use': {
        const toolName = String(msg.meta?.toolName ?? 'unknown');
        const raw = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);

        // msg-tidy: aggregate tool calls, show think with stats + last tool preview
        if (messageMode === 'msg-tidy') {
          let agg = this.toolAggregates.get(identityKey);
          if (!agg) {
            agg = { toolCounts: {}, lastToolName: '', lastToolContent: '', totalCalls: 0 };
            this.toolAggregates.set(identityKey, agg);
          }
          agg.toolCounts[toolName] = (agg.toolCounts[toolName] ?? 0) + 1;
          agg.lastToolName = toolName;
          agg.lastToolContent = raw.slice(0, 100);
          agg.totalCalls++;

          // Format stats chain: Read(3) → Grep(2)
          const statsChain = Object.entries(agg.toolCounts)
            .map(([name, count]) => `${name}(${count})`)
            .join(' → ');

          // Ensure think stream is active
          if (!this.streamStates.has(identityKey)) {
            const state: StreamState = { buffer: '', intermediateCount: 0, lastFlushAt: 0, flushTimer: null };
            this.streamStates.set(identityKey, state);
          }
          const state = this.streamStates.get(identityKey)!;

          // Send think with stats + last tool preview
          if (state.intermediateCount < MAX_INTERMEDIATE_MSGS) {
            const thinkText = `<think>\n【${sessionName}】正在处理... 🔧 ${statsChain}\n──\n📄 ${toolName}: ${agg.lastToolContent}\n</think>`;
            provider.sendMessage({ identity, text: thinkText, kind: 'typing' })
              .catch((err) => console.error('[ChannelRouter] tidy think error:', err));
            state.intermediateCount++;
            state.lastFlushAt = Date.now();
          }
          break; // Don't send individual tool_use message
        }

        // msg-total: existing behavior (send individual tool messages)
        // ... existing tool_use code ...
```

For `tool_result`, add similar aggregation at the beginning:
```typescript
      case 'tool_result': {
        // msg-tidy: skip individual tool_result, just re-enter think
        if (messageMode === 'msg-tidy') {
          // The tool_use handler already updated aggregation state
          // Just ensure think state stays active
          const state = this.streamStates.get(identityKey);
          if (state && state.intermediateCount < MAX_INTERMEDIATE_MSGS) {
            const agg = this.toolAggregates.get(identityKey);
            const statsChain = agg
              ? Object.entries(agg.toolCounts).map(([name, count]) => `${name}(${count})`).join(' → ')
              : '';
            provider.sendMessage({
              identity,
              text: `<think>\n【${sessionName}】正在处理... 🔧 ${statsChain}\n</think>`,
              kind: 'typing',
            }).catch((err) => console.error('[ChannelRouter] tidy re-think error:', err));
            state.intermediateCount++;
            state.lastFlushAt = Date.now();
          }
          break; // Don't send individual tool_result
        }

        // msg-total: existing behavior
        // ... existing tool_result code ...
```

6. In the `assistant` case, before sending the final reply, send the tool statistics summary if in msg-tidy mode:
```typescript
      case 'assistant': {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        if (!text.trim()) break;

        // msg-tidy: send final tool stats before the reply
        const agg = this.toolAggregates.get(identityKey);
        if (messageMode === 'msg-tidy' && agg && agg.totalCalls > 0) {
          const statsList = Object.entries(agg.toolCounts)
            .map(([name, count]) => `${name}(${count})`)
            .join(', ');
          const statsMsg = `🔧 已完成 ${agg.totalCalls} 次工具调用: ${statsList}`;
          provider.sendMessage({ identity, text: statsMsg, kind: 'message', format: 'markdown' })
            .catch((err) => console.error('[ChannelRouter] tidy stats error:', err));
          this.toolAggregates.delete(identityKey);
        }

        // ... existing assistant handling (store buffer, finishStream) ...
```

7. In the `result` case, clean up tool aggregates:
```typescript
      case 'result': {
        // Clean up tool aggregation state
        const tidyAgg = this.toolAggregates.get(identityKey);
        if (tidyAgg && tidyAgg.totalCalls > 0) {
          // If assistant message was never sent, send stats now
          if (messageMode === 'msg-tidy') {
            const statsList = Object.entries(tidyAgg.toolCounts)
              .map(([name, count]) => `${name}(${count})`)
              .join(', ');
            const statsMsg = `🔧 已完成 ${tidyAgg.totalCalls} 次工具调用: ${statsList}`;
            provider.sendMessage({ identity, text: statsMsg, kind: 'message', format: 'markdown' })
              .catch((err) => console.error('[ChannelRouter] tidy stats error:', err));
          }
        }
        this.toolAggregates.delete(identityKey);

        // ... existing result handling ...
```

- [ ] **Step 2: Add `/new` and `/msg-*` handling in IM slash commands**

In the `handleSlashCommand()` method of `ChannelRouterImpl`, add before the delegation to shared handler:

```typescript
      case '/new':
        return await this.cmdNew(identityKey);
      case '/msg-only':
      case '/msg-tidy':
      case '/msg-total':
        return this.cmdMsgMode(identityKey, cmd.slice(1) as MessageMode);
```

Add the methods:

```typescript
  /** /new — Rebuild CLI session */
  private async cmdNew(identityKey: string): Promise<string> {
    const binding = getBinding(this.db, identityKey);
    const sessionId = binding?.active_session_id;
    if (!sessionId) {
      return '⚠️ 当前未绑定任何会话。';
    }
    try {
      await this.sessionManager.rebuildSession(sessionId);
      return '✅ CLI 会话已重建。';
    } catch (err) {
      return `⚠️ 重建失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** /msg-* — Switch message mode */
  private cmdMsgMode(identityKey: string, mode: MessageMode): string {
    const binding = getBinding(this.db, identityKey);
    const sessionId = binding?.active_session_id;
    if (!sessionId) {
      return '⚠️ 当前未绑定任何会话。';
    }
    try {
      this.sessionManager.configureSession(sessionId, { messageMode: mode } as any);
      return `✅ 消息模式已切换为 \`${mode}\``;
    } catch (err) {
      return `⚠️ 切换失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
```

- [ ] **Step 3: Build and verify**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm --filter @openlobby/server build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/channel-router.ts
git commit -m "feat(channel-router): add msg-tidy aggregation and /new, /msg-* IM commands"
```

---

## Task 8: Web — Lobby Store + WebSocket Updates for Message Mode

**Files:**
- Modify: `packages/web/src/stores/lobby-store.ts`
- Modify: `packages/web/src/hooks/useWebSocket.ts`

- [ ] **Step 1: Update `SessionSummaryData` in lobby-store.ts**

Add `messageMode` to `SessionSummaryData`:

```typescript
export interface SessionSummaryData {
  // ... existing fields ...
  messageMode?: string;
}
```

Add tool call aggregator state and server config:

```typescript
export interface ToolCallAggregator {
  isAggregating: boolean;
  toolCounts: Record<string, number>;
  lastToolName: string;
  lastToolContent: string;
  totalCalls: number;
}

interface LobbyState {
  // ... existing fields ...

  // Tool call aggregation for msg-tidy mode
  toolAggregatorBySession: Record<string, ToolCallAggregator>;

  // Server config cache
  serverConfig: Record<string, string>;

  updateToolAggregator: (sessionId: string, updater: (agg: ToolCallAggregator) => ToolCallAggregator) => void;
  resetToolAggregator: (sessionId: string) => void;
  setServerConfig: (key: string, value: string) => void;
}
```

Add implementations in the `create<LobbyState>` call:

```typescript
  toolAggregatorBySession: {},
  serverConfig: {},

  updateToolAggregator: (sessionId, updater) =>
    set((state) => {
      const current = state.toolAggregatorBySession[sessionId] ?? {
        isAggregating: false,
        toolCounts: {},
        lastToolName: '',
        lastToolContent: '',
        totalCalls: 0,
      };
      return {
        toolAggregatorBySession: {
          ...state.toolAggregatorBySession,
          [sessionId]: updater(current),
        },
      };
    }),

  resetToolAggregator: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.toolAggregatorBySession;
      return { toolAggregatorBySession: rest };
    }),

  setServerConfig: (key, value) =>
    set((state) => ({
      serverConfig: { ...state.serverConfig, [key]: value },
    })),
```

- [ ] **Step 2: Update useWebSocket.ts to handle config messages and msg-tidy aggregation**

In `packages/web/src/hooks/useWebSocket.ts`:

1. Add `config.value` handler in the `onmessage` switch:
```typescript
      case 'config.value':
        if ((data as any).key && (data as any).value !== undefined) {
          state.setServerConfig((data as any).key, (data as any).value);
        }
        break;
```

2. Update the `message` case to handle msg-tidy aggregation:
```typescript
      case 'message':
        if (data.sessionId && data.message) {
          const msgType = data.message.type;
          const session = state.sessions[data.sessionId];
          const messageMode = session?.messageMode ?? 'msg-total';

          // msg-only: filter out tool_use/tool_result on client side too
          if (messageMode === 'msg-only' && (msgType === 'tool_use' || msgType === 'tool_result')) {
            break;
          }

          // msg-tidy: aggregate tool calls instead of showing individually
          if (messageMode === 'msg-tidy' && (msgType === 'tool_use' || msgType === 'tool_result')) {
            if (msgType === 'tool_use') {
              const toolName = (data.message.meta as any)?.toolName ?? 'unknown';
              const content = typeof data.message.content === 'string'
                ? data.message.content
                : JSON.stringify(data.message.content);
              state.updateToolAggregator(data.sessionId, (agg) => ({
                isAggregating: true,
                toolCounts: { ...agg.toolCounts, [toolName]: (agg.toolCounts[toolName] ?? 0) + 1 },
                lastToolName: toolName,
                lastToolContent: content.slice(0, 200),
                totalCalls: agg.totalCalls + 1,
              }));
            }
            // Don't add to message list — aggregator handles display
            // But still update typing state
            state.setTyping(data.sessionId, true);
            break;
          }

          // msg-tidy: finalize aggregator on assistant/result
          if (messageMode === 'msg-tidy' && (msgType === 'assistant' || msgType === 'result')) {
            const agg = state.toolAggregatorBySession[data.sessionId];
            if (agg && agg.totalCalls > 0) {
              // Add a synthetic tool summary message before the assistant reply
              const statsList = Object.entries(agg.toolCounts)
                .map(([name, count]) => `${name}(${count})`)
                .join(', ');
              const summaryMsg: import('../stores/lobby-store').LobbyMessageData = {
                id: `tool-summary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                sessionId: data.sessionId,
                timestamp: Date.now(),
                type: 'tool_summary' as any,
                content: `🔧 已完成 ${agg.totalCalls} 次工具调用: ${statsList}`,
              };
              state.addMessage(data.sessionId, summaryMsg);
              state.resetToolAggregator(data.sessionId);
            }
          }

          state.addMessage(data.sessionId, data.message);
          if (msgType === 'result') {
            state.setTyping(data.sessionId, false);
          }
          if (msgType === 'stream_delta' || msgType === 'tool_use' || msgType === 'tool_result') {
            state.setTyping(data.sessionId, true);
          }
        }
        break;
```

3. Add config send helpers:
```typescript
export function wsGetConfig(key: string): void {
  wsSend({ type: 'config.get', key });
}

export function wsSetConfig(key: string, value: string): void {
  wsSend({ type: 'config.set', key, value });
}
```

4. Request config values on connection open (after `session.list`):
```typescript
  ws.onopen = () => {
    console.log('[WS] Connected');
    useLobbyStore.getState().setConnected(true);
    wsSend({ type: 'session.list' });
    wsSend({ type: 'config.get', key: 'defaultAdapter' });
    wsSend({ type: 'config.get', key: 'defaultMessageMode' });
  };
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/stores/lobby-store.ts packages/web/src/hooks/useWebSocket.ts
git commit -m "feat(web): add message mode state, tool aggregation, and config protocol support"
```

---

## Task 9: Web — ToolSummaryBubble Component

**Files:**
- Create: `packages/web/src/components/ToolSummaryBubble.tsx`
- Modify: `packages/web/src/components/MessageList.tsx`

- [ ] **Step 1: Create ToolSummaryBubble component**

Create `packages/web/src/components/ToolSummaryBubble.tsx`:

```tsx
import React from 'react';
import type { ToolCallAggregator } from '../stores/lobby-store';

interface Props {
  /** Live aggregator (still collecting tool calls) */
  aggregator?: ToolCallAggregator;
  /** Finalized summary text (after tool calls complete) */
  summaryText?: string;
}

export default function ToolSummaryBubble({ aggregator, summaryText }: Props) {
  if (summaryText) {
    // Finalized: static summary
    return (
      <div className="flex justify-start px-4 py-1">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-xs text-gray-400 max-w-lg">
          {summaryText}
        </div>
      </div>
    );
  }

  if (!aggregator || !aggregator.isAggregating) return null;

  // Live: tool calls in progress
  const statsChain = Object.entries(aggregator.toolCounts)
    .map(([name, count]) => `${name}(${count})`)
    .join(' → ');

  const lastPreview = aggregator.lastToolContent
    ? aggregator.lastToolContent.slice(0, 200) + (aggregator.lastToolContent.length > 200 ? '...' : '')
    : '';

  return (
    <div className="flex justify-start px-4 py-1">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-xs max-w-lg animate-pulse">
        <div className="text-gray-300">
          🔧 正在处理... {statsChain}
        </div>
        {lastPreview && (
          <>
            <div className="border-t border-gray-700/50 my-1" />
            <div className="text-gray-500 font-mono whitespace-pre-wrap break-all">
              📄 {aggregator.lastToolName}: {lastPreview}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update MessageList.tsx to render ToolSummaryBubble**

In `packages/web/src/components/MessageList.tsx`:

1. Add imports:
```tsx
import ToolSummaryBubble from './ToolSummaryBubble';
import { useLobbyStore } from '../stores/lobby-store';
```

2. Inside the component, after rendering all messages and before the typing indicator, add the live aggregator:

```tsx
  // Get tool aggregator for current session
  const toolAggregator = useLobbyStore((s) =>
    activeSessionId ? s.toolAggregatorBySession[activeSessionId] : undefined
  );
  const session = useLobbyStore((s) =>
    activeSessionId ? s.sessions[activeSessionId] : undefined
  );
```

3. In the JSX, after the messages map and before the typing indicator:

```tsx
  {/* Live tool aggregation for msg-tidy mode */}
  {session?.messageMode === 'msg-tidy' && toolAggregator?.isAggregating && (
    <ToolSummaryBubble aggregator={toolAggregator} />
  )}
```

4. In the messages render, handle `tool_summary` type messages:

```tsx
  {/* Inside the messages map */}
  {msg.type === 'tool_summary' ? (
    <ToolSummaryBubble summaryText={typeof msg.content === 'string' ? msg.content : ''} />
  ) : (
    // ... existing MessageBubble rendering ...
  )}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ToolSummaryBubble.tsx packages/web/src/components/MessageList.tsx
git commit -m "feat(web): add ToolSummaryBubble component for msg-tidy mode"
```

---

## Task 10: Web — RoomHeader Message Mode Dropdown

**Files:**
- Modify: `packages/web/src/components/RoomHeader.tsx`

- [ ] **Step 1: Add message mode dropdown to RoomHeader settings panel**

In `packages/web/src/components/RoomHeader.tsx`:

1. Add import:
```tsx
import { wsConfigureSession, wsTogglePlanMode } from '../hooks/useWebSocket';
```
(Already imported, just add `wsConfigureSession` if not present.)

2. Add state for message mode:
```tsx
const [messageMode, setMessageMode] = useState('');
```

3. In the settings open handler, initialize messageMode:
```tsx
onClick={() => {
  setShowSettings(!showSettings);
  setModel(session.model ?? '');
  setPermissionMode(session.permissionMode ?? '');
  setMessageMode(session.messageMode ?? 'msg-tidy');
}}
```

4. In the settings panel (inside the `<div className="border-t border-gray-700 pt-3 space-y-2">` block), add after Permission Mode dropdown:

```tsx
              <div>
                <label className="text-xs text-gray-400 block mb-1">Message Mode</label>
                <select
                  value={messageMode}
                  onChange={(e) => setMessageMode(e.target.value)}
                  className="w-full bg-gray-800 text-gray-100 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="msg-tidy">Tidy (collapse tools)</option>
                  <option value="msg-only">Messages only</option>
                  <option value="msg-total">All messages</option>
                </select>
              </div>
```

5. In `handleApplyConfig()`, include messageMode:
```tsx
  const handleApplyConfig = () => {
    const opts: Record<string, unknown> = {};
    if (model.trim()) opts.model = model.trim();
    if (permissionMode) opts.permissionMode = permissionMode;
    if (messageMode) opts.messageMode = messageMode;
    if (Object.keys(opts).length > 0) {
      wsConfigureSession(activeSessionId, opts);
      useLobbyStore.getState().updateSession({
        ...session,
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(messageMode ? { messageMode } : {}),
      });
    }
    setShowSettings(false);
  };
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/RoomHeader.tsx
git commit -m "feat(web): add message mode dropdown in RoomHeader settings"
```

---

## Task 11: Web — NewSessionDialog Default Adapter + Message Mode

**Files:**
- Modify: `packages/web/src/components/NewSessionDialog.tsx`

- [ ] **Step 1: Use global config defaults in NewSessionDialog**

In `packages/web/src/components/NewSessionDialog.tsx`:

1. Add import:
```tsx
import { useLobbyStore } from '../stores/lobby-store';
```

2. Read defaults from server config:
```tsx
export default function NewSessionDialog({ onClose }: Props) {
  const serverConfig = useLobbyStore((s) => s.serverConfig);
  const defaultAdapter = (serverConfig.defaultAdapter ?? 'claude-code') as 'claude-code' | 'codex-cli' | 'opencode';
  const defaultMessageMode = serverConfig.defaultMessageMode ?? 'msg-tidy';

  const [adapter, setAdapter] = useState<'claude-code' | 'codex-cli' | 'opencode'>(defaultAdapter);
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [model, setModel] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [permissionMode, setPermissionMode] = useState('default');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [initialPrompt, setInitialPrompt] = useState('');
  const [messageMode, setMessageMode] = useState(defaultMessageMode);
```

3. In `handleSubmit`, include messageMode in options:
```tsx
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cwd.trim()) return;

    wsCreateSession(
      adapter,
      {
        cwd: cwd.trim(),
        prompt: initialPrompt.trim() || undefined,
        model: model.trim() || undefined,
        permissionMode: permissionMode !== 'default' ? permissionMode : undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        messageMode,
      },
      name.trim() || undefined,
    );
    onClose();
  };
```

4. Add message mode selector in the Advanced section (after Permission Mode):
```tsx
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Message Mode
                  </label>
                  <select
                    value={messageMode}
                    onChange={(e) => setMessageMode(e.target.value)}
                    className="w-full bg-gray-800 text-gray-100 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="msg-tidy">Tidy (collapse tool calls)</option>
                    <option value="msg-only">Messages only</option>
                    <option value="msg-total">All messages</option>
                  </select>
                </div>
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/NewSessionDialog.tsx
git commit -m "feat(web): use global defaults for adapter and message mode in NewSessionDialog"
```

---

## Task 12: Web — Global Settings Panel

**Files:**
- Create: `packages/web/src/components/GlobalSettings.tsx`
- Modify: `packages/web/src/components/Sidebar.tsx`

- [ ] **Step 1: Create GlobalSettings component**

Create `packages/web/src/components/GlobalSettings.tsx`:

```tsx
import React, { useState } from 'react';
import { useLobbyStore } from '../stores/lobby-store';
import { wsSetConfig } from '../hooks/useWebSocket';

interface Props {
  onClose: () => void;
}

export default function GlobalSettings({ onClose }: Props) {
  const serverConfig = useLobbyStore((s) => s.serverConfig);
  const [defaultAdapter, setDefaultAdapter] = useState(serverConfig.defaultAdapter ?? 'claude-code');
  const [defaultMessageMode, setDefaultMessageMode] = useState(serverConfig.defaultMessageMode ?? 'msg-tidy');
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingAdapter, setPendingAdapter] = useState('');

  const handleAdapterChange = (value: string) => {
    if (value !== (serverConfig.defaultAdapter ?? 'claude-code')) {
      setPendingAdapter(value);
      setShowConfirm(true);
    } else {
      setDefaultAdapter(value);
    }
  };

  const confirmAdapterChange = () => {
    setDefaultAdapter(pendingAdapter);
    wsSetConfig('defaultAdapter', pendingAdapter);
    setShowConfirm(false);
  };

  const handleMessageModeChange = (value: string) => {
    setDefaultMessageMode(value);
    wsSetConfig('defaultMessageMode', value);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-xl p-6 w-full max-w-sm border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-4 text-gray-100">Global Settings</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Default Adapter</label>
            <select
              value={defaultAdapter}
              onChange={(e) => handleAdapterChange(e.target.value)}
              className="w-full bg-gray-800 text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="claude-code">Claude Code</option>
              <option value="codex-cli">Codex CLI</option>
              <option value="opencode">OpenCode</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Affects new sessions and Lobby Manager
            </p>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Default Message Mode</label>
            <select
              value={defaultMessageMode}
              onChange={(e) => handleMessageModeChange(e.target.value)}
              className="w-full bg-gray-800 text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="msg-tidy">Tidy (collapse tool calls)</option>
              <option value="msg-only">Messages only</option>
              <option value="msg-total">All messages</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Default for newly created sessions
            </p>
          </div>
        </div>

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 rounded-lg hover:bg-gray-800"
          >
            Close
          </button>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]" onClick={() => setShowConfirm(false)}>
          <div className="bg-gray-800 rounded-xl w-96 border border-gray-600 shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-100 mb-2">
              切换默认 Adapter？
            </h3>
            <p className="text-xs text-gray-400 mb-4">
              切换默认 Adapter 将重建 Lobby Manager，历史记录不保留。确认？
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-3 py-1.5 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={confirmAdapterChange}
                className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add settings button to Sidebar**

In `packages/web/src/components/Sidebar.tsx`, add a settings button at the bottom. Import the component:

```tsx
import GlobalSettings from './GlobalSettings';
```

Add state:
```tsx
const [showGlobalSettings, setShowGlobalSettings] = useState(false);
```

Add the button at the bottom of the sidebar (before closing `</div>`):
```tsx
        <button
          onClick={() => setShowGlobalSettings(true)}
          className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition-colors"
        >
          ⚙️ Settings
        </button>

        {showGlobalSettings && (
          <GlobalSettings onClose={() => setShowGlobalSettings(false)} />
        )}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/GlobalSettings.tsx packages/web/src/components/Sidebar.tsx
git commit -m "feat(web): add global settings panel with default adapter and message mode"
```

---

## Task 13: Build + Integration Verification

**Files:** None new — verify all packages compile and work together.

- [ ] **Step 1: Build all packages**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm -r build`
Expected: All packages build successfully.

- [ ] **Step 2: Start dev server and verify**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm --filter @openlobby/server dev`
Expected: Server starts, SQLite migrations run, LM session created.

- [ ] **Step 3: Manual verification checklist**

Test the following scenarios:
1. `/new` in any session → CLI session rebuilds, system message appears
2. `/msg-only` → tool messages stop appearing, replies still show
3. `/msg-tidy` → tool calls collapse into summary, final stats shown
4. `/msg-total` → all messages appear (default old behavior)
5. Global Settings → change default adapter → LM rebuilds
6. New session dialog → defaults reflect global config
7. RoomHeader settings → message mode dropdown works
8. Approval/control messages appear in all modes

- [ ] **Step 4: Fix any issues found during verification**

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address integration issues from manual testing"
```
