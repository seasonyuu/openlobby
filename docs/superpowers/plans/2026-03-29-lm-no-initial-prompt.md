# LM No-Default-InitialPrompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When LM creates/switches sessions, auto-navigate without sending initialPrompt — user sends their first message themselves.

**Architecture:** Three surgical edits to server package: add `navigate` field to MCP API create endpoint, add `autoNavigate` param to MCP tool, update LM system prompt to stop passing initialPrompt.

**Tech Stack:** TypeScript, Fastify, Zod, MCP SDK

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/server/src/mcp-api.ts` | Modify lines 47-84 | Add `navigate` boolean to POST /api/sessions, call broadcastNavigate when true |
| `packages/server/src/mcp-server.ts` | Modify lines 60-81 | Add `autoNavigate` param (default true), pass `navigate` to API, update `initialPrompt` description |
| `packages/server/src/lobby-manager.ts` | Modify lines 40-48 | Rewrite Step 2 in LM_SYSTEM_PROMPT to not pass initialPrompt and describe auto-navigate |

---

### Task 1: Add `navigate` field to MCP API create endpoint

**Files:**
- Modify: `packages/server/src/mcp-api.ts:47-84`

- [ ] **Step 1: Add `navigate` to the Body type and destructure it**

In `packages/server/src/mcp-api.ts`, replace lines 47-56:

```typescript
  // Create session
  app.post<{
    Body: {
      adapter: string;
      cwd: string;
      name?: string;
      model?: string;
      initialPrompt?: string;
    };
  }>('/api/sessions', async (request, reply) => {
    const { adapter, cwd, name, model, initialPrompt } = request.body;
```

with:

```typescript
  // Create session
  app.post<{
    Body: {
      adapter: string;
      cwd: string;
      name?: string;
      model?: string;
      initialPrompt?: string;
      navigate?: boolean;
    };
  }>('/api/sessions', async (request, reply) => {
    const { adapter, cwd, name, model, initialPrompt, navigate } = request.body;
```

- [ ] **Step 2: Add broadcastNavigate call after session creation**

In the same file, replace lines 67-78:

```typescript
      // Send initial prompt if provided
      if (initialPrompt) {
        await sessionManager.sendMessage(session.id, initialPrompt);
      }

      return {
        id: session.id,
        adapterName: session.adapterName,
        displayName: session.displayName,
        status: session.status,
        cwd: session.cwd,
      };
```

with:

```typescript
      // Send initial prompt if provided
      if (initialPrompt) {
        await sessionManager.sendMessage(session.id, initialPrompt);
      }

      // Auto-navigate to the new session (triggers Web UI switch + IM binding)
      if (navigate) {
        sessionManager.broadcastNavigate(session.id);
      }

      return {
        id: session.id,
        adapterName: session.adapterName,
        displayName: session.displayName,
        status: session.status,
        cwd: session.cwd,
      };
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/mcp-api.ts
git commit -m "feat(mcp-api): add navigate option to POST /api/sessions

When navigate=true, broadcastNavigate is called after session creation,
triggering Web UI switch and IM channel binding in one API call."
```

---

### Task 2: Add `autoNavigate` param to MCP tool `lobby_create_session`

**Files:**
- Modify: `packages/server/src/mcp-server.ts:60-81`

- [ ] **Step 1: Add `autoNavigate` parameter and update `initialPrompt` description**

In `packages/server/src/mcp-server.ts`, replace lines 60-81:

```typescript
  // --- Tool: lobby_create_session ---
  server.tool(
    'lobby_create_session',
    'Create a new Agentic CLI session. Directory will be auto-created if it does not exist.',
    {
      adapter: z.enum(['claude-code', 'codex-cli']).default('claude-code').describe('CLI adapter to use (default: claude-code)'),
      cwd: z.string().describe('Working directory for the session'),
      name: z.string().optional().describe('Display name for the session'),
      model: z.string().optional().describe('Model to use (e.g. claude-sonnet-4-5-20250514)'),
      initialPrompt: z.string().optional().describe('Initial message to send to the session after creation'),
    },
    async ({ adapter, cwd, name, model, initialPrompt }) => {
      const result = await apiCall('POST', '/api/sessions', {
        adapter,
        cwd,
        name,
        model,
        initialPrompt,
      });
      return textResult(result);
    },
  );
```

with:

```typescript
  // --- Tool: lobby_create_session ---
  server.tool(
    'lobby_create_session',
    'Create a new Agentic CLI session. Directory will be auto-created if it does not exist. By default, auto-navigates the user to the new session (Web UI + IM channel switch).',
    {
      adapter: z.enum(['claude-code', 'codex-cli']).default('claude-code').describe('CLI adapter to use (default: claude-code)'),
      cwd: z.string().describe('Working directory for the session'),
      name: z.string().optional().describe('Display name for the session'),
      model: z.string().optional().describe('Model to use (e.g. claude-sonnet-4-5-20250514)'),
      initialPrompt: z.string().optional().describe('Optional initial message — only pass when explicitly needed, not by default'),
      autoNavigate: z.boolean().default(true).describe('Auto-navigate user to the new session after creation (default: true)'),
    },
    async ({ adapter, cwd, name, model, initialPrompt, autoNavigate }) => {
      const result = await apiCall('POST', '/api/sessions', {
        adapter,
        cwd,
        name,
        model,
        initialPrompt,
        navigate: autoNavigate,
      });
      return textResult(result);
    },
  );
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/mcp-server.ts
git commit -m "feat(mcp-server): add autoNavigate param to lobby_create_session

Defaults to true. Passes navigate=true to MCP API so session creation
auto-switches Web UI and IM channel. Updated initialPrompt description
to discourage default usage."
```

---

### Task 3: Update LM system prompt

**Files:**
- Modify: `packages/server/src/lobby-manager.ts:40-48`

- [ ] **Step 1: Replace Step 2 in LM_SYSTEM_PROMPT**

In `packages/server/src/lobby-manager.ts`, replace lines 40-49:

```typescript
Step 2: The user sent a task (e.g., "处理周报", "build a todo app", "fix the bug", "帮我写个脚本", ANY request that is not about session/channel management).
  → Use lobby_list_sessions to find a matching session (by name, cwd, or purpose).
  → Found match: Present it and ask "要切换到这个会话吗？" / "Switch to this session?"
  → No match: Propose creating a new session:
    - adapter: claude-code (default)
    - cwd: ~/.agentlobby/lobby-manager/projects/<project-name>/
    - name: auto-generated from user's intent
    - Ask user to confirm
  → After user confirms: create/navigate, pass user's original message as initialPrompt.
  → NEVER attempt the task yourself. Not even partially. Not even "let me help you with that".
```

with:

```typescript
Step 2: The user sent a task (e.g., "处理周报", "build a todo app", "fix the bug", "帮我写个脚本", ANY request that is not about session/channel management).
  → Use lobby_list_sessions to find a matching session (by name, cwd, or purpose).
  → Found match: Present it and ask "要切换到这个会话吗？" / "Switch to this session?"
    → After user confirms: call lobby_navigate_session to switch. Do NOT send any message to the session.
  → No match: Propose creating a new session:
    - adapter: claude-code (default)
    - cwd: ~/.agentlobby/lobby-manager/projects/<project-name>/
    - name: auto-generated from user's intent
    - Ask user to confirm
  → After user confirms: call lobby_create_session (autoNavigate defaults to true — auto-switches Web UI and IM channel). Do NOT pass initialPrompt.
  → Tell the user: "会话已创建并已切换，请在新会话中发送你的指令。" / "Session created and switched. Send your message in the new session."
  → IMPORTANT: NEVER pass initialPrompt unless the user explicitly asks you to forward a message.
  → NEVER attempt the task yourself. Not even partially. Not even "let me help you with that".
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/lobby-manager.ts
git commit -m "feat(lobby-manager): stop passing initialPrompt on session create/switch

LM now creates sessions without forwarding user message. Auto-navigate
handles Web UI + IM channel switching. User sends first message themselves."
```

---

### Task 4: Manual verification

- [ ] **Step 1: Build the server package**

```bash
cd /Users/kone/OtherProjects/mist/OpenLobby
pnpm --filter @openlobby/server build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Verify MCP API change**

Read `packages/server/src/mcp-api.ts` and confirm:
- `navigate?: boolean` is in the Body type
- `navigate` is destructured from `request.body`
- `if (navigate) { sessionManager.broadcastNavigate(session.id); }` appears after `initialPrompt` handling

- [ ] **Step 3: Verify MCP tool change**

Read `packages/server/src/mcp-server.ts` and confirm:
- `autoNavigate` param exists with `z.boolean().default(true)`
- `initialPrompt` description says "only pass when explicitly needed"
- `navigate: autoNavigate` is passed in the API call body

- [ ] **Step 4: Verify system prompt change**

Read `packages/server/src/lobby-manager.ts` and confirm:
- Step 2 no longer mentions "pass user's original message as initialPrompt"
- "Do NOT pass initialPrompt" appears for both found-match and create-new paths
- "NEVER pass initialPrompt unless the user explicitly asks" rule exists
