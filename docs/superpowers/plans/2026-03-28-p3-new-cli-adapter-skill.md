# P3: New CLI Adapter Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a project-level Claude Code skill that auto-generates a complete, tested adapter package when the user requests integration with a new Agentic CLI.

**Architecture:** A single SKILL.md file in `.claude/skills/` that contains the full generation template, checklist, and code patterns. When triggered, Claude Code researches the target CLI, generates the adapter package, runs integration tests, and registers it — all automatically.

**Tech Stack:** Claude Code skills system (SKILL.md format)

**Prerequisite:** P1 (integration tests) and P2 (plugin system) must be complete.

---

### Task 1: Create the Skill File

**Files:**
- Create: `.claude/skills/new-cli-adapter.md`

- [ ] **Step 1: Create the skill directory if needed**

```bash
mkdir -p .claude/skills
```

- [ ] **Step 2: Write the skill file**

Create `.claude/skills/new-cli-adapter.md`:

```markdown
---
name: new-cli-adapter
description: Generate a complete OpenLobby CLI adapter package for a new Agentic CLI tool. Triggered when the user asks to add, integrate, or support a new CLI agent (e.g. Aider, Continue, Cursor Agent). Produces a tested, pluggable adapter package.
---

# New CLI Adapter for OpenLobby

You are generating a new CLI adapter package for OpenLobby. Follow these steps exactly.

## Step 1: Research the Target CLI

Before writing any code, investigate the target CLI:

1. **Communication protocol:** Does it have an SDK/library? A subprocess mode with JSON-RPC/NDJSON? An HTTP API?
2. **Authentication:** API key? OAuth? Environment variable name?
3. **Session management:** How are sessions identified? Can they be resumed?
4. **Message format:** What do responses look like? Streaming or batch?
5. **Tool/approval system:** Does it have tool approval? How is it signaled?
6. **History storage:** Where does it store session history on disk? File format?
7. **Commands/skills:** Does it have a way to list available commands?

Use WebSearch, WebFetch, and Read tools to gather this information from docs, SDKs, and source code.

## Step 2: Generate the Package

Create `packages/adapter-<name>/` with these files:

### package.json

```json
{
  "name": "openlobby-adapter-<name>",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "dev": "tsc --watch"
  },
  "peerDependencies": {
    "@openlobby/core": "workspace:*"
  },
  "devDependencies": {
    "@openlobby/core": "workspace:*",
    "@types/node": "^25.5.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

### tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

### vitest.config.ts

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 60_000,
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

### src/index.ts — AdapterPluginModule export

```ts
import type { AdapterPluginModule } from '@openlobby/core';
import { <Name>Adapter } from './<name>-adapter.js';

export const adapterName = '<name>';
export const displayName = '<Display Name>';
export function createAdapter() { return new <Name>Adapter(); }

const plugin: AdapterPluginModule = { adapterName, displayName, createAdapter };
export default plugin;
```

### src/<name>-adapter.ts — AgentAdapter implementation

Implement all required methods. Reference existing adapters:
- `packages/core/src/adapters/claude-code.ts` for SDK-based communication
- `packages/core/src/adapters/codex-cli.ts` for subprocess-based communication

### src/<name>-process.ts — AgentProcess implementation

Implement all required methods and events.

**CRITICAL patterns to follow (from existing adapters):**

1. **Session ID sync:** Start with a UUID, update to real CLI ID when received.
   Emit via system message so SessionManager can track the change.

2. **Wire-before-send:** Constructor must NOT start execution.
   The caller wires events first, then calls `sendMessage()`.

3. **Approval timeout:** Pending tool approvals auto-deny after 5 minutes.
   Always include `interrupt: true` on timeout deny.

4. **Plan mode:** Inject system prompt restricting to read-only tools.
   Auto-deny write tools in `handleToolApproval`.

5. **Settings loading:** If using an SDK, pass settings sources.
   If subprocess, CLI auto-loads its own config.

6. **Commands event:** Emit `'commands'` with `AdapterCommand[]` after first query.
   Use CLI's API to fetch available commands/skills if possible.

7. **Message type conversion:** Map ALL CLI outputs to LobbyMessage types:
   - Init/handshake → `system` (must include sessionId)
   - Text response → `assistant`
   - Streaming chunk → `stream_delta`
   - Tool call → `tool_use` (meta.toolName + input as content)
   - Tool result → `tool_result` (meta.isError)
   - Approval request → `control` (content: {requestId, toolName, toolInput})
   - Turn complete → `result` (meta: {costUsd, tokenUsage})
   - Error → `system` (meta.isError = true)

### src/__tests__/<name>.test.ts — Integration test (one line)

```ts
import { createAdapterIntegrationTests } from '@openlobby/core/adapters/__tests__/adapter-contract.js';
import { <Name>Adapter } from '../<name>-adapter.js';

createAdapterIntegrationTests(<Name>Adapter);
```

## Step 3: Install Dependencies

```bash
pnpm install
```

## Step 4: Run Tests — HARD GATE

```bash
pnpm --filter openlobby-adapter-<name> test
```

**ALL tests must pass.** If any fail, fix the adapter and re-run.
Do NOT proceed to Step 5 until all tests pass.

## Step 5: Register the Adapter

The adapter is discovered automatically by the plugin system.
To register it permanently:

```bash
# The server auto-discovers installed adapter packages at startup.
# Just ensure the package is in the workspace and built.
pnpm -r build
```

## Step 6: Verify End-to-End

1. Start the server: `pnpm --filter @openlobby/server dev`
2. Check health: `curl http://127.0.0.1:3001/health` — new adapter should appear
3. Create a session with the new adapter in the web UI
4. Send a message and verify response
5. Test tool approval if the CLI supports it
```

- [ ] **Step 3: Verify the skill file is valid**

The skill should be loadable by Claude Code. Test by checking:

```bash
cat .claude/skills/new-cli-adapter.md | head -5
```

Expected: Shows the YAML frontmatter with name and description.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/new-cli-adapter.md
git commit -m "feat: add new-cli-adapter skill for Claude Code"
```

---

### Task 2: Test the Skill with a Dry Run

**Files:** None (verification only)

- [ ] **Step 1: Verify the skill appears in Claude Code's skill list**

In Claude Code, type `/` and check if `new-cli-adapter` appears in the commands list (it may appear as a skill rather than a slash command depending on Claude Code version).

- [ ] **Step 2: Test trigger recognition**

In Claude Code, say: "Add Aider adapter to OpenLobby"

The skill should trigger and Claude Code should begin the research + generation flow.

- [ ] **Step 3: Document any adjustments needed**

If the skill doesn't trigger or the flow needs adjustments, update the skill file and re-commit.

```bash
git add .claude/skills/new-cli-adapter.md
git commit -m "fix: adjust skill trigger and flow"
```
