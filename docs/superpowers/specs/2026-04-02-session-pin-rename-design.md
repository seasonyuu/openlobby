# Session Pin & Rename Design

## Overview

Add two session management features to the sidebar session list:
1. **Pin/unpin sessions** — pinned sessions stay at the top of the list (WeChat-style)
2. **Rename sessions** — edit the session display name inline via an icon button

## Data Layer

### Database

Add a column to the `sessions` table:

```sql
ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
```

- `0` = not pinned, `1` = pinned
- Uses INTEGER per SQLite convention (no native BOOLEAN)

### Core Type

Add `pinned` field to `SessionSummary`:

```ts
pinned: boolean;
```

`displayName` already exists — no change needed.

### DB Functions

- **New:** `updateSessionPinned(id: string, pinned: boolean)` — update pinned status
- **Existing:** `updateSessionDisplayName()` — reuse as-is
- **Update:** `upsertSession()`, `getSession()`, `getAllSessions()` — include `pinned` in read/write

## Protocol Layer

### Client → Server Messages

```ts
// Pin/unpin a session
{ type: 'session.pin', sessionId: string, pinned: boolean }

// Rename a session
{ type: 'session.rename', sessionId: string, displayName: string }
```

### Server → Client Messages

No new message types. Reuse `session.updated` — broadcast the updated `SessionSummary` (including `pinned` and `displayName`) to all connected clients.

### ws-handler Routing

- `session.pin` → `sessionManager.pinSession(id, pinned)` → update DB + memory → broadcast `session.updated`
- `session.rename` → `sessionManager.renameSession(id, displayName)` → update DB + memory → broadcast `session.updated`

### Frontend WebSocket Hook

Add helper functions:
- `wsPinSession(sessionId: string, pinned: boolean)`
- `wsRenameSession(sessionId: string, displayName: string)`

## Cache & DB Synchronization

### Write Order (SessionManager)

For both `pinSession()` and `renameSession()`:

1. **Write DB first** — call `updateSessionPinned()` / `updateSessionDisplayName()`
2. **Update in-memory state** — modify `ManagedSession` object
3. **Broadcast** — `broadcastSessionUpdate()` sends `session.updated`

This order ensures persistence is never lost even if the process crashes between steps.

### listSessions() Merge

`listSessions()` merges active in-memory sessions with stopped DB-only sessions:
- `toSummary()` must output the `pinned` field from the in-memory `ManagedSession`
- For DB-only stopped sessions, `pinned` is read directly from the database row

### Frontend Optimistic Updates

- Zustand store updates immediately on user action (optimistic update)
- WebSocket message sent concurrently
- When `session.updated` arrives from server, store overwrites with server value (source of truth)
- No explicit rollback mechanism needed — pin/rename operations are simple writes that won't fail under normal conditions

## Frontend Interaction

### SessionCard Changes

On hover, show two icon buttons in the top-right area of each session card:

- **📌 Pin button** — toggles pinned state
  - When pinned: icon is always visible (not just on hover), uses theme accent color
  - When not pinned: icon appears only on hover
- **✏️ Edit button** — enters inline rename mode
  - Appears only on hover
  - Clicking replaces the display name text with an `<input>` field
  - Enter or blur confirms the new name
  - Esc cancels and reverts

### Sorting Logic

Sidebar session list sorting:

1. `pinned` descending (pinned sessions on top)
2. `lastActiveAt` descending within each group (most recent first)
3. `lobby-manager` session remains fixed at the bottom, excluded from this sort

### Visual Distinction

- Pinned sessions have a subtly different background color (slightly darker/highlighted) to visually separate them from unpinned sessions
- The pin icon uses theme accent color when active

### Zustand Store

- `updateSession()` already handles `session.updated` — `pinned` flows in naturally via `SessionSummary`
- Add `pinSession(id, pinned)` action — optimistic store update + call `wsPinSession()`
- Add `renameSession(id, name)` action — optimistic store update + call `wsRenameSession()`
