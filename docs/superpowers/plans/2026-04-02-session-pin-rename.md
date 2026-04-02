# Session Pin & Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pin/unpin and rename capabilities to the session list sidebar, with DB persistence and real-time sync across all connected clients.

**Architecture:** DB migration adds `pinned` column to `sessions` table. New WebSocket message types `session.pin` and `session.rename` are handled by `SessionManager`, which writes DB first, updates in-memory state, then broadcasts `session.updated`. Frontend uses optimistic updates in the Zustand store, with icon buttons on the `SessionCard` component.

**Tech Stack:** SQLite (better-sqlite3), TypeScript, React, Zustand, Tailwind CSS, WebSocket

---

### Task 1: Add `pinned` field to Core types

**Files:**
- Modify: `packages/core/src/types.ts:92-113` (SessionSummary interface)

- [ ] **Step 1: Add `pinned` field to `SessionSummary`**

In `packages/core/src/types.ts`, add `pinned` to the `SessionSummary` interface after `messageMode`:

```ts
  messageMode?: MessageMode;
  /** Whether this session is pinned to the top of the list */
  pinned?: boolean;
```

- [ ] **Step 2: Build core package to verify**

Run: `pnpm --filter @openlobby/core build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): add pinned field to SessionSummary"
```

---

### Task 2: Add `session.pin` and `session.rename` to protocol

**Files:**
- Modify: `packages/core/src/protocol.ts:17-61` (ClientMessage type)

- [ ] **Step 1: Add new client message types**

In `packages/core/src/protocol.ts`, add these two union members to the `ClientMessage` type, after the `compact` line (before the semicolon closing the type):

```ts
  | { type: 'session.pin'; sessionId: string; pinned: boolean }
  | { type: 'session.rename'; sessionId: string; displayName: string };
```

Remove the semicolon from the `compact` line (it becomes a union member, not the last one). The final lines of `ClientMessage` should look like:

```ts
  | { type: 'compact'; sessionId: string; instructions?: string }
  | { type: 'session.pin'; sessionId: string; pinned: boolean }
  | { type: 'session.rename'; sessionId: string; displayName: string };
```

- [ ] **Step 2: Build core package to verify**

Run: `pnpm --filter @openlobby/core build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/protocol.ts
git commit -m "feat(core): add session.pin and session.rename protocol messages"
```

---

### Task 3: Add `pinned` column to DB and DB functions

**Files:**
- Modify: `packages/server/src/db.ts:6-20` (SessionRow interface)
- Modify: `packages/server/src/db.ts:22-137` (initDb — add migration)
- Modify: `packages/server/src/db.ts:139-146` (upsertSession — include pinned)
- Modify: `packages/server/src/db.ts:173-179` (add updateSessionPinned function)

- [ ] **Step 1: Add `pinned` to `SessionRow` interface**

In `packages/server/src/db.ts`, add to the `SessionRow` interface (after `message_mode`):

```ts
  pinned: number;
```

- [ ] **Step 2: Add DB migration in `initDb()`**

In `packages/server/src/db.ts`, add after the `message_mode` migration block (after line 134, before `return db;`):

```ts
  // Migration: add pinned column if not exists
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }
```

- [ ] **Step 3: Update `upsertSession()` to include `pinned`**

Replace the `upsertSession` function:

```ts
export function upsertSession(db: Database.Database, row: SessionRow): void {
  db.prepare(`
    INSERT OR REPLACE INTO sessions
      (id, adapter_name, display_name, cwd, jsonl_path, origin, status, created_at, last_active_at, model, tags, permission_mode, message_mode, pinned)
    VALUES
      (@id, @adapter_name, @display_name, @cwd, @jsonl_path, @origin, @status, @created_at, @last_active_at, @model, @tags, @permission_mode, @message_mode, @pinned)
  `).run(row);
}
```

- [ ] **Step 4: Add `updateSessionPinned()` function**

Add after the existing `updateSessionDisplayName()` function:

```ts
export function updateSessionPinned(
  db: Database.Database,
  id: string,
  pinned: boolean,
): void {
  db.prepare('UPDATE sessions SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
}
```

- [ ] **Step 5: Build server package to verify**

Run: `pnpm --filter @openlobby/server build`
Expected: Build succeeds. (There will be errors in session-manager.ts because `persistSession` doesn't pass `pinned` yet — that's fixed in the next task.)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/db.ts
git commit -m "feat(server): add pinned column to sessions table with migration"
```

---

### Task 4: Add `pinned` to `ManagedSession`, `toSummary()`, `persistSession()`, and `listSessions()`

**Files:**
- Modify: `packages/server/src/session-manager.ts:28-54` (ManagedSession interface)
- Modify: `packages/server/src/session-manager.ts:212-228` (toSummary)
- Modify: `packages/server/src/session-manager.ts:457-474` (persistSession)
- Modify: `packages/server/src/session-manager.ts:705-746` (listSessions)

- [ ] **Step 1: Add `pinned` to `ManagedSession` interface**

In `packages/server/src/session-manager.ts`, add to the `ManagedSession` interface (after `messageMode`):

```ts
  /** Whether this session is pinned to the top of the sidebar */
  pinned: boolean;
```

- [ ] **Step 2: Add `updateSessionPinned` to imports**

Update the import from `./db.js` to include `updateSessionPinned`:

```ts
import {
  upsertSession,
  deleteSession as dbDeleteSession,
  updateSessionStatus,
  updateSessionDisplayName,
  updateSessionPinned,
  getAllSessions,
  getSessionCommands,
  upsertSessionCommands,
  getServerConfig,
  getAdapterDefault,
  getAllAdapterDefaults,
  setAdapterDefault,
} from './db.js';
```

- [ ] **Step 3: Update `toSummary()` to include `pinned`**

Add `pinned` to the return object in `toSummary()`:

```ts
  private toSummary(s: ManagedSession): SessionSummary {
    return {
      id: s.id,
      adapterName: s.adapterName,
      displayName: s.displayName,
      status: s.status,
      lastActiveAt: s.lastActiveAt,
      lastMessage: s.lastMessage,
      messageCount: s.messageCount,
      model: s.model,
      permissionMode: s.permissionMode ?? undefined,
      cwd: s.cwd,
      origin: s.origin,
      messageMode: s.messageMode,
      pinned: s.pinned,
      resumeCommand: this.buildResumeCommand(s),
    };
  }
```

- [ ] **Step 4: Update `persistSession()` to include `pinned`**

Add `pinned` to the upsert call in `persistSession()`:

```ts
  private persistSession(session: ManagedSession): void {
    if (!this.db) return;
    upsertSession(this.db, {
      id: session.id,
      adapter_name: session.adapterName,
      display_name: session.displayName,
      cwd: session.cwd,
      jsonl_path: null,
      origin: session.origin,
      status: session.status,
      created_at: session.createdAt,
      last_active_at: session.lastActiveAt,
      model: session.model ?? null,
      tags: null,
      permission_mode: session.permissionMode ?? null,
      message_mode: session.messageMode,
      pinned: session.pinned ? 1 : 0,
    });
  }
```

- [ ] **Step 5: Initialize `pinned: false` in `createSession()`**

Find the `createSession` method (around line 476). Wherever the `ManagedSession` object is constructed (look for the object literal with `id`, `adapterName`, etc.), add:

```ts
      pinned: false,
```

Do the same for any other places where `ManagedSession` objects are created — search for `previousIds:` in the file, as that's unique to `ManagedSession` construction. This likely includes `resumeSession()`, `importSession()`, `rebuildSession()`, and `recoverSession()`.

- [ ] **Step 6: Update `listSessions()` to include `pinned` for DB-only sessions**

In `listSessions()`, update the object pushed for DB-only rows (around line 725-739) to include `pinned`:

```ts
        result.push({
          id: row.id,
          adapterName: row.adapter_name,
          displayName: row.display_name ?? row.id.slice(0, 8),
          status: row.status,
          lastActiveAt: row.last_active_at,
          messageCount: 0,
          model: row.model ?? undefined,
          permissionMode: (row.permission_mode as PermissionMode | null) ?? undefined,
          cwd: row.cwd,
          origin: row.origin as 'lobby' | 'cli',
          messageMode: (row.message_mode as MessageMode) ?? 'msg-tidy',
          resumeCommand: resumeCmd,
          jsonlPath: row.jsonl_path ?? undefined,
          pinned: row.pinned === 1,
        });
```

- [ ] **Step 7: Build server package to verify**

Run: `pnpm --filter @openlobby/server build`
Expected: Build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/session-manager.ts
git commit -m "feat(server): add pinned field to ManagedSession and session lifecycle"
```

---

### Task 5: Add `pinSession()` and `renameSession()` methods to SessionManager

**Files:**
- Modify: `packages/server/src/session-manager.ts` (add methods after `configureSession`)

- [ ] **Step 1: Add `pinSession()` method**

Add after the `configureSession()` method (around line 579):

```ts
  pinSession(sessionId: string, pinned: boolean): void {
    // Write DB first for crash safety
    if (this.db) {
      updateSessionPinned(this.db, sessionId, pinned);
    }
    // Update in-memory session if active
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pinned = pinned;
      this.broadcastSessionUpdate(session);
    }
  }

  renameSession(sessionId: string, displayName: string): void {
    // Write DB first for crash safety
    if (this.db) {
      updateSessionDisplayName(this.db, sessionId, displayName);
    }
    // Update in-memory session if active
    const session = this.sessions.get(sessionId);
    if (session) {
      session.displayName = displayName;
      this.broadcastSessionUpdate(session);
    }
  }
```

- [ ] **Step 2: Build server package to verify**

Run: `pnpm --filter @openlobby/server build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/session-manager.ts
git commit -m "feat(server): add pinSession and renameSession methods"
```

---

### Task 6: Handle `session.pin` and `session.rename` in ws-handler

**Files:**
- Modify: `packages/server/src/ws-handler.ts:112-508` (add cases to switch)

- [ ] **Step 1: Add handler cases**

In `packages/server/src/ws-handler.ts`, add these two cases inside the `switch (data.type)` block, before the `default:` case (around line 502):

```ts
        case 'session.pin': {
          sessionManager.pinSession(data.sessionId, data.pinned);
          break;
        }

        case 'session.rename': {
          sessionManager.renameSession(data.sessionId, data.displayName);
          break;
        }
```

- [ ] **Step 2: Build server package to verify**

Run: `pnpm --filter @openlobby/server build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/ws-handler.ts
git commit -m "feat(server): handle session.pin and session.rename in ws-handler"
```

---

### Task 7: Add `pinned` to frontend store and WebSocket helpers

**Files:**
- Modify: `packages/web/src/stores/lobby-store.ts:3-23` (SessionSummaryData interface)
- Modify: `packages/web/src/hooks/useWebSocket.ts:270-276` (add wsPinSession, wsRenameSession)

- [ ] **Step 1: Add `pinned` to `SessionSummaryData`**

In `packages/web/src/stores/lobby-store.ts`, add to the `SessionSummaryData` interface (after `channelBinding`):

```ts
  pinned?: boolean;
```

- [ ] **Step 2: Add `wsPinSession` and `wsRenameSession` helpers**

In `packages/web/src/hooks/useWebSocket.ts`, add after the `wsCompactSession` function (around line 406):

```ts
export function wsPinSession(sessionId: string, pinned: boolean): void {
  wsSend({ type: 'session.pin', sessionId, pinned });
}

export function wsRenameSession(sessionId: string, displayName: string): void {
  wsSend({ type: 'session.rename', sessionId, displayName });
}
```

- [ ] **Step 3: Build web package to verify**

Run: `pnpm --filter @openlobby/web build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/stores/lobby-store.ts packages/web/src/hooks/useWebSocket.ts
git commit -m "feat(web): add pinned to store and WebSocket pin/rename helpers"
```

---

### Task 8: Update `SessionCard` with pin and rename UI

**Files:**
- Modify: `packages/web/src/components/Sidebar.tsx:1-94` (SessionCard component)

- [ ] **Step 1: Update SessionCard to accept callbacks and add state**

Replace the entire `SessionCard` component with:

```tsx
function SessionCard({
  session,
  isActive,
  onClick,
  onPin,
  onRename,
}: {
  session: SessionSummaryData;
  isActive: boolean;
  onClick: () => void;
  onPin: (pinned: boolean) => void;
  onRename: (name: string) => void;
}) {
  const config = statusConfig[session.status] ?? statusConfig.idle;
  const isAwaiting = session.status === 'awaiting_approval';
  const isPinned = session.pinned ?? false;
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(session.displayName);
  const [isHovered, setIsHovered] = useState(false);

  const handleRenameConfirm = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== session.displayName) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  const handleRenameCancel = () => {
    setEditName(session.displayName);
    setIsEditing(false);
  };

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors relative ${
        isActive
          ? 'bg-gray-700 border-l-2 border-blue-400'
          : isPinned
            ? 'bg-gray-800/60 hover:bg-gray-800'
            : 'hover:bg-gray-800'
      } ${
        isAwaiting
          ? 'bg-orange-900/30 border-l-2 border-orange-400 ring-1 ring-orange-500/30'
          : ''
      }`}
    >
      {/* Action buttons */}
      {(isHovered || isPinned) && !isEditing && (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 z-10">
          <span
            onClick={(e) => {
              e.stopPropagation();
              onPin(!isPinned);
            }}
            className={`p-0.5 rounded text-xs cursor-pointer transition-colors ${
              isPinned
                ? 'text-blue-400 hover:text-blue-300'
                : isHovered
                  ? 'text-gray-500 hover:text-gray-300'
                  : 'hidden'
            }`}
            title={isPinned ? 'Unpin' : 'Pin to top'}
          >
            &#x1F4CC;
          </span>
          {isHovered && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                setEditName(session.displayName);
                setIsEditing(true);
              }}
              className="p-0.5 rounded text-xs text-gray-500 hover:text-gray-300 cursor-pointer transition-colors"
              title="Rename"
            >
              &#x270F;&#xFE0F;
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mb-1">
        <span
          className={`inline-block w-2 h-2 rounded-full ${config.color} ${
            config.pulse ? 'animate-pulse' : ''
          }`}
          title={config.label}
        />
        {isEditing ? (
          <input
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameConfirm();
              if (e.key === 'Escape') handleRenameCancel();
            }}
            onBlur={handleRenameConfirm}
            onClick={(e) => e.stopPropagation()}
            className="text-sm font-medium text-gray-100 bg-gray-600 border border-gray-500 rounded px-1 py-0 flex-1 outline-none focus:border-blue-400"
          />
        ) : (
          <span className="text-sm font-medium text-gray-100 truncate flex-1">
            {session.displayName}
          </span>
        )}
        {isAwaiting ? (
          <span className="text-[10px] text-orange-300 bg-orange-500/20 px-1.5 py-0.5 rounded font-medium animate-pulse">
            Approval
          </span>
        ) : (
          <span className="text-xs text-gray-500 uppercase">
            {session.adapterName === 'claude-code' ? 'CC' : session.adapterName === 'codex-cli' ? 'CX' : session.adapterName === 'opencode' ? 'OC' : session.adapterName}
          </span>
        )}
      </div>
      {session.channelBinding && (
        <div className="flex items-center gap-1 pl-4 mb-0.5">
          <span className="text-[10px] text-purple-400 bg-purple-500/15 px-1.5 py-0.5 rounded">
            {session.channelBinding.channelName}: {session.channelBinding.peerDisplayName ?? session.channelBinding.peerId}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between pl-4">
        <span className="text-xs text-gray-400 truncate flex-1">
          {session.lastMessage ?? session.cwd}
        </span>
        <span className="text-xs text-gray-500 ml-2 whitespace-nowrap">
          {formatRelativeTime(session.lastActiveAt)}
        </span>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Update Sidebar sorting and SessionCard usage**

In the `Sidebar` component, update the sorting logic and add the `wsPinSession`/`wsRenameSession` imports.

First, update the import at the top of the file:

```ts
import { wsRequestSessionHistory, wsDiscoverSessions, wsPinSession, wsRenameSession } from '../hooks/useWebSocket';
```

Then update the `sortedSessions` computation:

```ts
  const sortedSessions = Object.values(sessions)
    .filter((s) => s.origin !== 'lobby-manager')
    .sort((a, b) => {
      // Pinned sessions first
      const aPinned = a.pinned ? 1 : 0;
      const bPinned = b.pinned ? 1 : 0;
      if (bPinned !== aPinned) return bPinned - aPinned;
      // Then by last active time
      return b.lastActiveAt - a.lastActiveAt;
    });
```

Then update the `SessionCard` usage in the JSX:

```tsx
          {sortedSessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              isActive={activeSessionId === session.id}
              onClick={() => handleSelectSession(session.id)}
              onPin={(pinned) => {
                // Optimistic update
                useLobbyStore.getState().updateSession({ ...session, pinned });
                wsPinSession(session.id, pinned);
              }}
              onRename={(name) => {
                // Optimistic update
                useLobbyStore.getState().updateSession({ ...session, displayName: name });
                wsRenameSession(session.id, name);
              }}
            />
          ))}
```

- [ ] **Step 3: Build web package to verify**

Run: `pnpm --filter @openlobby/web build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/Sidebar.tsx
git commit -m "feat(web): add pin/rename UI to SessionCard with optimistic updates"
```

---

### Task 9: Full build verification

**Files:** None (verification only)

- [ ] **Step 1: Build all packages**

Run: `pnpm -r build`
Expected: All packages build successfully with no TypeScript errors.

- [ ] **Step 2: Quick manual verification checklist**

Verify by reading the code:
- `SessionSummary` in `types.ts` has `pinned?: boolean`
- `ClientMessage` in `protocol.ts` has `session.pin` and `session.rename`
- `SessionRow` in `db.ts` has `pinned: number`
- `initDb()` in `db.ts` has migration for `pinned` column
- `upsertSession()` includes `pinned` in INSERT
- `updateSessionPinned()` exists in `db.ts`
- `ManagedSession` has `pinned: boolean`
- `toSummary()` includes `pinned`
- `persistSession()` includes `pinned`
- `listSessions()` includes `pinned` for DB-only rows
- `createSession()` and other ManagedSession constructors set `pinned: false`
- `pinSession()` and `renameSession()` exist on SessionManager
- `ws-handler.ts` handles `session.pin` and `session.rename`
- `SessionSummaryData` has `pinned?: boolean`
- `wsPinSession()` and `wsRenameSession()` exist
- `SessionCard` shows pin/rename icons
- `Sidebar` sorts pinned first
