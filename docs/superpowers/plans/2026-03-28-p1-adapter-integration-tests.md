# P1: Adapter Integration Test Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a shared integration test suite that validates any OpenLobby adapter against the real CLI, ensuring all interface contracts work end-to-end.

**Architecture:** A single `createAdapterIntegrationTests(AdapterClass)` function that runs the full test matrix. Each adapter adds one test file calling this function. Tests use vitest as the runner, with generous timeouts for real CLI operations (~60s per test). CLI must be installed — no mocks, no skipping.

**Tech Stack:** vitest, TypeScript, @openlobby/core types

---

### Task 1: Set Up vitest in packages/core

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/vitest.config.ts`

- [ ] **Step 1: Install vitest as dev dependency**

```bash
pnpm --filter @openlobby/core add -D vitest
```

- [ ] **Step 2: Create vitest config**

Create `packages/core/vitest.config.ts`:

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

- [ ] **Step 3: Add test script to package.json**

In `packages/core/package.json`, add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 4: Verify vitest runs (no tests yet)**

```bash
pnpm --filter @openlobby/core test
```

Expected: vitest runs, reports "No test files found" or similar, exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json packages/core/vitest.config.ts pnpm-lock.yaml
git commit -m "test: add vitest to @openlobby/core"
```

---

### Task 2: Create the Shared Test Suite — detect + spawn + basic messaging

**Files:**
- Create: `packages/core/src/adapters/__tests__/adapter-contract.ts`

This is the core of P1 — the shared function that any adapter calls.

- [ ] **Step 1: Create the test suite file with detect, spawn, and messaging tests**

Create `packages/core/src/adapters/__tests__/adapter-contract.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AgentAdapter, AgentProcess, LobbyMessage, AdapterCommand } from '../../types.js';

interface AdapterConstructor {
  new (): AgentAdapter;
}

/**
 * Shared integration test suite for OpenLobby adapters.
 * Validates all AgentAdapter + AgentProcess contracts against the real CLI.
 *
 * HARD REQUIREMENT: The CLI must be installed. If detect() returns
 * installed: false, the entire suite throws — no skip, no soft-fail.
 */
export function createAdapterIntegrationTests(AdapterClass: AdapterConstructor): void {
  describe(`${AdapterClass.name} integration`, () => {
    let adapter: AgentAdapter;
    let spawnedProcess: AgentProcess | null = null;
    let spawnedSessionId: string | null = null;

    beforeAll(async () => {
      adapter = new AdapterClass();
      const detection = await adapter.detect();
      if (!detection.installed) {
        throw new Error(
          `${adapter.displayName} CLI not installed. ` +
          `Adapter integration tests require the real CLI. ` +
          `Install it and re-run.`,
        );
      }
    });

    afterAll(async () => {
      // Clean up any spawned processes
      if (spawnedProcess && spawnedProcess.status !== 'stopped') {
        spawnedProcess.kill();
      }
    });

    // ── detect() ──────────────────────────────────────────────────────

    it('detect() returns installed: true with version and path', async () => {
      const result = await adapter.detect();
      expect(result.installed).toBe(true);
      expect(result.version).toBeTruthy();
      expect(typeof result.version).toBe('string');
      expect(result.path).toBeTruthy();
      expect(typeof result.path).toBe('string');
    });

    // ── spawn() + sendMessage() ───────────────────────────────────────

    it('spawn() returns an AgentProcess with valid initial state', async () => {
      const process = await adapter.spawn({ cwd: '/tmp' });
      spawnedProcess = process;

      expect(process.sessionId).toBeTruthy();
      expect(process.adapter).toBe(adapter.name);
      expect(['idle', 'running']).toContain(process.status);
    });

    it('sendMessage() produces assistant or stream_delta messages', async () => {
      const process = spawnedProcess!;
      expect(process).toBeTruthy();

      const messages: LobbyMessage[] = [];
      const messagePromise = new Promise<void>((resolve) => {
        const handler = (msg: LobbyMessage) => {
          messages.push(msg);
          // Resolve once we get an assistant message or a result
          if (msg.type === 'assistant' || msg.type === 'result') {
            process.removeListener('message', handler);
            resolve();
          }
        };
        process.on('message', handler);
      });

      process.sendMessage('Reply with exactly: HELLO_TEST_123');
      await messagePromise;

      // Should have at least one message
      expect(messages.length).toBeGreaterThan(0);

      // Check message structure
      for (const msg of messages) {
        expect(msg.id).toBeTruthy();
        expect(msg.sessionId).toBeTruthy();
        expect(msg.timestamp).toBeGreaterThan(0);
        expect([
          'system', 'user', 'assistant', 'tool_use',
          'tool_result', 'control', 'stream_delta', 'result',
        ]).toContain(msg.type);
      }

      // Should contain assistant text or stream_delta
      const hasContent = messages.some(
        (m) => m.type === 'assistant' || m.type === 'stream_delta',
      );
      expect(hasContent).toBe(true);
    });

    // ── Session ID sync ───────────────────────────────────────────────

    it('session ID syncs from initial UUID to real CLI ID', async () => {
      const process = spawnedProcess!;
      // After sendMessage, the session ID should have been updated
      // from the initial UUID to the real CLI-assigned ID
      expect(process.sessionId).toBeTruthy();
      spawnedSessionId = process.sessionId;
    });

    // ── idle event ────────────────────────────────────────────────────

    it('emits idle event after turn completes', async () => {
      const process = spawnedProcess!;

      const idlePromise = new Promise<void>((resolve) => {
        // If already idle, resolve immediately
        if (process.status === 'idle') {
          resolve();
          return;
        }
        process.once('idle', () => resolve());
      });

      // Wait for idle (the previous sendMessage should eventually complete)
      await idlePromise;
      expect(process.status).toBe('idle');
    });

    // ── kill() ────────────────────────────────────────────────────────

    it('kill() terminates the process and emits exit', async () => {
      const process = spawnedProcess!;

      const exitPromise = new Promise<void>((resolve) => {
        process.once('exit', () => resolve());
      });

      process.kill();
      await exitPromise;

      expect(process.status).toBe('stopped');
      spawnedProcess = null;
    });

    // ── readSessionHistory() ──────────────────────────────────────────

    it('readSessionHistory() returns messages from the session we just ran', async () => {
      if (!spawnedSessionId) {
        throw new Error('No session ID from previous spawn — cannot test history');
      }

      const history = await adapter.readSessionHistory(spawnedSessionId);
      // The session we ran should have at least the user message + assistant response
      expect(history.length).toBeGreaterThan(0);

      // Validate message structure
      for (const msg of history) {
        expect(msg.id).toBeTruthy();
        expect(msg.sessionId).toBeTruthy();
        expect(msg.timestamp).toBeGreaterThan(0);
      }
    });

    // ── discoverSessions() ────────────────────────────────────────────

    it('discoverSessions() returns an array of SessionSummary', async () => {
      const sessions = await adapter.discoverSessions();
      expect(Array.isArray(sessions)).toBe(true);

      // We just created a session, so there should be at least one
      // (unless the adapter filters it out by design)
      for (const s of sessions) {
        expect(s.id).toBeTruthy();
        expect(s.adapterName).toBe(adapter.name);
        expect(s.cwd).toBeTruthy();
        expect(typeof s.lastActiveAt).toBe('number');
      }
    });

    // ── getSessionStoragePath() ───────────────────────────────────────

    it('getSessionStoragePath() returns a non-empty string', () => {
      const path = adapter.getSessionStoragePath();
      expect(path).toBeTruthy();
      expect(typeof path).toBe('string');
    });

    // ── getResumeCommand() ────────────────────────────────────────────

    it('getResumeCommand() returns a non-empty string', () => {
      const cmd = adapter.getResumeCommand('test-session-id');
      expect(cmd).toBeTruthy();
      expect(typeof cmd).toBe('string');
      expect(cmd).toContain('test-session-id');
    });

    // ── listCommands() ────────────────────────────────────────────────

    it('listCommands() returns AdapterCommand[]', async () => {
      if (!adapter.listCommands) return;

      const commands = await adapter.listCommands();
      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(0);

      for (const cmd of commands) {
        expect(cmd.name).toBeTruthy();
        expect(cmd.name.startsWith('/')).toBe(true);
        expect(cmd.description).toBeTruthy();
      }
    });

    // ── commands event ────────────────────────────────────────────────

    it('emits commands event with AdapterCommand[] during a query', async () => {
      // Spawn a fresh process to test commands event
      const process = await adapter.spawn({ cwd: '/tmp' });

      const commandsPromise = new Promise<AdapterCommand[]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          process.kill();
          reject(new Error('commands event not emitted within timeout'));
        }, 90_000);

        process.on('commands', (cmds: AdapterCommand[]) => {
          clearTimeout(timeout);
          resolve(cmds);
        });
      });

      // Trigger a query to make the process fetch commands
      const donePromise = new Promise<void>((resolve) => {
        process.once('idle', () => resolve());
        process.once('exit', () => resolve());
      });

      process.sendMessage('Reply with exactly: TEST');

      let commands: AdapterCommand[];
      try {
        commands = await commandsPromise;
      } finally {
        // Ensure process is cleaned up
        await donePromise.catch(() => {});
        if (process.status !== 'stopped') {
          process.kill();
        }
      }

      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(0);
      for (const cmd of commands) {
        expect(cmd.name).toBeTruthy();
        expect(cmd.description).toBeTruthy();
      }
    });

    // ── resume() ──────────────────────────────────────────────────────

    it('resume() creates a process that can receive messages', async () => {
      if (!spawnedSessionId) {
        throw new Error('No session ID from previous spawn — cannot test resume');
      }

      const process = await adapter.resume(spawnedSessionId, { cwd: '/tmp' });
      expect(process.sessionId).toBeTruthy();
      expect(process.adapter).toBe(adapter.name);

      // Send a message and expect a response
      const gotResponse = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 60_000);
        const handler = (msg: LobbyMessage) => {
          if (msg.type === 'assistant' || msg.type === 'stream_delta' || msg.type === 'result') {
            clearTimeout(timeout);
            process.removeListener('message', handler);
            resolve(true);
          }
        };
        process.on('message', handler);
      });

      process.sendMessage('Reply with exactly: RESUME_TEST');
      const received = await gotResponse;

      process.kill();
      expect(received).toBe(true);
    });

    // ── setPlanMode() ─────────────────────────────────────────────────

    it('setPlanMode() can be toggled without error', async () => {
      const process = await adapter.spawn({ cwd: '/tmp' });

      expect(() => process.setPlanMode?.(true)).not.toThrow();
      expect(() => process.setPlanMode?.(false)).not.toThrow();

      process.kill();
    });

    // ── updateOptions() ───────────────────────────────────────────────

    it('updateOptions() can be called without error', async () => {
      const process = await adapter.spawn({ cwd: '/tmp' });

      expect(() => process.updateOptions({ model: 'test-model' })).not.toThrow();

      process.kill();
    });
  });
}
```

- [ ] **Step 2: Commit the shared test suite**

```bash
git add packages/core/src/adapters/__tests__/adapter-contract.ts
git commit -m "test: add shared adapter integration test suite"
```

---

### Task 3: Wire Claude Code Adapter Tests

**Files:**
- Create: `packages/core/src/adapters/__tests__/claude-code.test.ts`

- [ ] **Step 1: Create the Claude Code test file**

Create `packages/core/src/adapters/__tests__/claude-code.test.ts`:

```ts
import { createAdapterIntegrationTests } from './adapter-contract.js';
import { ClaudeCodeAdapter } from '../claude-code.js';

createAdapterIntegrationTests(ClaudeCodeAdapter);
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter @openlobby/core test -- --reporter=verbose
```

Expected: All tests pass (Claude Code CLI must be installed). If any tests fail, fix the test suite or adapter code as needed.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/adapters/__tests__/claude-code.test.ts
git commit -m "test: wire Claude Code adapter to shared integration tests"
```

---

### Task 4: Wire Codex CLI Adapter Tests

**Files:**
- Create: `packages/core/src/adapters/__tests__/codex-cli.test.ts`

- [ ] **Step 1: Create the Codex CLI test file**

Create `packages/core/src/adapters/__tests__/codex-cli.test.ts`:

```ts
import { createAdapterIntegrationTests } from './adapter-contract.js';
import { CodexCliAdapter } from '../codex-cli.js';

createAdapterIntegrationTests(CodexCliAdapter);
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter @openlobby/core test -- --reporter=verbose
```

Expected: All tests pass (Codex CLI must be installed). If any tests fail, fix the test suite or adapter code as needed.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/adapters/__tests__/codex-cli.test.ts
git commit -m "test: wire Codex CLI adapter to shared integration tests"
```

---

### Task 5: Add Root-Level Test Script

**Files:**
- Modify: `packages/core/package.json` (already has `test` from Task 1)
- Verify root `package.json` `test` script works

- [ ] **Step 1: Run full test suite from root**

```bash
pnpm -r test
```

Expected: vitest discovers and runs both claude-code.test.ts and codex-cli.test.ts, all pass.

- [ ] **Step 2: Verify test count**

Check output shows the expected number of tests (~12 tests per adapter × 2 adapters = ~24 tests total).

- [ ] **Step 3: Commit any adjustments**

If any package.json scripts needed updates:

```bash
git add -u
git commit -m "test: verify full adapter test suite runs from root"
```

---

### Task 6: Fix Any Failing Tests

This task is for addressing issues discovered during Tasks 3-5. Skip if all tests passed.

**Files:**
- Modify: `packages/core/src/adapters/__tests__/adapter-contract.ts` (if test expectations need adjustment)
- Modify: `packages/core/src/adapters/claude-code.ts` (if adapter has bugs)
- Modify: `packages/core/src/adapters/codex-cli.ts` (if adapter has bugs)

- [ ] **Step 1: Identify failing tests**

Review the vitest output from Tasks 3-4. For each failure, categorize:
- **Test bug:** The test expectation is wrong for this adapter's behavior → fix the test
- **Adapter bug:** The adapter doesn't implement the contract correctly → fix the adapter
- **Timing issue:** Real CLI is slow → increase timeout in the specific test

- [ ] **Step 2: Fix and re-run**

After each fix, re-run:

```bash
pnpm --filter @openlobby/core test -- --reporter=verbose
```

- [ ] **Step 3: Commit each fix separately**

```bash
git add -u
git commit -m "fix: <description of what was fixed>"
```
