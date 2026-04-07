# Terminal Mode for IM Conversation Page

## Overview

Add a real terminal mode to the Web IM conversation page. Users can toggle between IM (chat bubbles) and Terminal (xterm.js) modes per session. Terminal mode connects to the CLI process via node-pty, providing the same experience as using the CLI directly in a terminal emulator.

## Core Behavior

- **Toggle switch** in RoomHeader: IM / Terminal, replaces the entire chat area
- **Terminal mode** embeds xterm.js, backed by a server-side PTY (node-pty)
- **Auto-resume**: switching to Terminal spawns the CLI's resume command automatically (e.g. `claude --resume <session-id>`)
- **State preservation**: PTY stays alive when switching back to IM; switching back to Terminal restores the terminal state
- **Default view mode**: system-level configuration (persisted in SQLite) controls whether new sessions open in IM or Terminal mode

## Architecture

### Protocol — New Message Types

Added to `packages/core/src/protocol.ts`:

**Client → Server:**
- `session.open-pty { sessionId, cols, rows }` — request PTY creation
- `session.close-pty { sessionId }` — request PTY teardown
- `pty.input { sessionId, data: string }` — user keystrokes → PTY stdin
- `pty.resize { sessionId, cols, rows }` — terminal resize

**Server → Client:**
- `pty.opened { sessionId }` — PTY ready
- `pty.output { sessionId, data: string }` — PTY stdout → xterm.js
- `pty.closed { sessionId }` — PTY terminated
- `pty.error { sessionId, error: string }` — PTY error

All messages flow over the existing WebSocket connection (no new port).

### Backend — PtyManager

New file: `packages/server/src/pty-manager.ts`

Responsibilities:
- Maintain a `Map<sessionId, IPty>` of active PTY instances
- On `session.open-pty`: look up the session's adapter type, get the resume command, spawn PTY via `node-pty`
- Pipe PTY output to the requesting WebSocket client as `pty.output` messages
- Pipe `pty.input` messages to PTY stdin
- Handle `pty.resize` by calling `pty.resize(cols, rows)`
- On `session.close-pty` or session destruction: kill PTY process, remove from map
- Emit `pty.error` on spawn failure or unexpected PTY exit

### Adapter — Resume Command

Each adapter provides a resume command. Add to the `AgentAdapter` interface:

```typescript
getResumeCommand(sessionId: string, cwd: string): { command: string; args: string[] };
```

Implementations:
- **Claude Code**: `{ command: 'claude', args: ['--resume', sessionId, '--yes'] }`
- **Codex CLI**: `{ command: 'codex', args: ['--resume', sessionId] }`
- **OpenCode**: adapter-specific

### Frontend — TerminalView Component

New file: `packages/web/src/components/TerminalView.tsx`

- Mounts `@xterm/xterm` terminal instance with `@xterm/addon-fit` for auto-sizing
- On mount: sends `session.open-pty` with current terminal dimensions
- Listens for `pty.output` messages, writes data to xterm
- On user input (xterm `onData`): sends `pty.input` to server
- On resize (ResizeObserver + fit addon): sends `pty.resize`
- xterm instance is cached so toggling back preserves terminal state

### Frontend — Mode Toggle

In `RoomHeader.tsx`:
- Add IM/Terminal toggle button group
- Store current view mode per session in Zustand store (`viewModeBySession: Record<string, 'im' | 'terminal'>`)

In `App.tsx` (or session content area):
- Conditional render: `viewMode === 'im'` → MessageList + MessageInput; `viewMode === 'terminal'` → TerminalView

### System Configuration — Default View Mode

- Add `ViewMode` type: `'im' | 'terminal'` to `packages/core/src/types.ts`
- Add `defaultViewMode` column to the existing settings/defaults table in SQLite
- Expose via existing settings protocol messages (alongside permission mode, message mode)
- Settings panel in frontend gets a new "Default View Mode" toggle
- When creating a new session, frontend reads this default to set initial view mode

## New Dependencies

- **Backend**: `node-pty` (native module, requires build tools)
- **Frontend**: `@xterm/xterm`, `@xterm/addon-fit`

## Out of Scope

- IM history replay in terminal (CLI manages its own history)
- Separate WebSocket port for PTY traffic
- Split-screen / side-by-side IM + Terminal view
- Web-based terminal without a backing OpenLobby session
