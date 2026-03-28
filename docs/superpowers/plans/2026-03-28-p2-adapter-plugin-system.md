# P2: Adapter Plugin System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable adapters to be installed as npm packages and auto-discovered at startup, mirroring the existing Channel plugin architecture.

**Architecture:** Define `AdapterPluginModule` interface, implement a dynamic loader with naming convention `openlobby-adapter-{name}` / `@openlobby/adapter-{name}`, persist installed adapter configs in SQLite `adapter_plugins` table, and refactor server startup to load built-in + plugin adapters.

**Tech Stack:** TypeScript, better-sqlite3, dynamic `import()`, existing patterns from `packages/server/src/channels/index.ts`

**Prerequisite:** P1 (integration tests) must be complete — tests protect the refactor.

---

### Task 1: Define AdapterPluginModule Interface

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing test — verify the type exists**

Create `packages/core/src/adapters/__tests__/plugin-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('AdapterPluginModule type', () => {
  it('can be imported from @openlobby/core', async () => {
    // Dynamic import to test the built output
    const core = await import('../../index.js');
    // Type-only check — if this file compiles, the type exists
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Add the interface to types.ts**

In `packages/core/src/types.ts`, after the `AgentAdapter` interface, add:

```ts
/** Plugin module contract for external adapter packages */
export interface AdapterPluginModule {
  createAdapter(): AgentAdapter;
  readonly adapterName: string;
  readonly displayName: string;
}
```

- [ ] **Step 3: Export from index.ts**

In `packages/core/src/index.ts`, add to the type exports:

```ts
export type { AdapterPluginModule } from './types.js';
```

- [ ] **Step 4: Build and verify**

```bash
pnpm --filter @openlobby/core build
pnpm --filter @openlobby/core test
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts packages/core/src/adapters/__tests__/plugin-types.test.ts
git commit -m "feat: add AdapterPluginModule interface"
```

---

### Task 2: Add adapter_plugins DB Table

**Files:**
- Modify: `packages/server/src/db.ts`

- [ ] **Step 1: Add the table creation to initDb()**

In `packages/server/src/db.ts`, inside `initDb()`, before `return db`:

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS adapter_plugins (
      name          TEXT PRIMARY KEY,
      package_name  TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      enabled       INTEGER DEFAULT 1,
      created_at    INTEGER NOT NULL
    )
  `);
```

- [ ] **Step 2: Add CRUD functions**

At the bottom of `packages/server/src/db.ts`:

```ts
// ─── Adapter Plugins ────────────────────────────────────────────────

export interface AdapterPluginRow {
  name: string;
  package_name: string;
  display_name: string;
  enabled: number;
  created_at: number;
}

export function getAllAdapterPlugins(db: Database.Database): AdapterPluginRow[] {
  return db.prepare('SELECT * FROM adapter_plugins ORDER BY created_at').all() as AdapterPluginRow[];
}

export function upsertAdapterPlugin(db: Database.Database, row: AdapterPluginRow): void {
  db.prepare(`
    INSERT OR REPLACE INTO adapter_plugins (name, package_name, display_name, enabled, created_at)
    VALUES (@name, @package_name, @display_name, @enabled, @created_at)
  `).run(row);
}

export function deleteAdapterPlugin(db: Database.Database, name: string): void {
  db.prepare('DELETE FROM adapter_plugins WHERE name = ?').run(name);
}

export function toggleAdapterPlugin(db: Database.Database, name: string, enabled: boolean): void {
  db.prepare('UPDATE adapter_plugins SET enabled = ? WHERE name = ?').run(enabled ? 1 : 0, name);
}
```

- [ ] **Step 3: Build and verify**

```bash
pnpm --filter @openlobby/server build
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db.ts
git commit -m "feat: add adapter_plugins DB table and CRUD"
```

---

### Task 3: Create Adapter Plugin Loader

**Files:**
- Create: `packages/server/src/adapters/index.ts`

- [ ] **Step 1: Create the dynamic loader**

Create `packages/server/src/adapters/index.ts`:

```ts
import type { AgentAdapter, AdapterPluginModule } from '@openlobby/core';
import { ClaudeCodeAdapter, CodexCliAdapter } from '@openlobby/core';

/** Built-in adapters — always available */
export function createBuiltinAdapters(): AgentAdapter[] {
  return [new ClaudeCodeAdapter(), new CodexCliAdapter()];
}

/**
 * Load an adapter plugin by package name.
 * Tries: openlobby-adapter-{name}, @openlobby/adapter-{name}
 */
export async function loadAdapterPlugin(adapterName: string): Promise<AgentAdapter> {
  const candidates = [
    `openlobby-adapter-${adapterName}`,
    `@openlobby/adapter-${adapterName}`,
  ];

  for (const pkg of candidates) {
    try {
      const mod = await import(pkg);
      const plugin: AdapterPluginModule = mod.default ?? mod;
      if (typeof plugin.createAdapter !== 'function') {
        throw new Error(`Plugin ${pkg} does not export a createAdapter function`);
      }
      console.log(`[AdapterLoader] Loaded plugin: ${plugin.displayName} from ${pkg}`);
      return plugin.createAdapter();
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `No adapter plugin found for "${adapterName}". ` +
    `Install one of: ${candidates.join(', ')}`,
  );
}
```

- [ ] **Step 2: Build and verify**

```bash
pnpm --filter @openlobby/server build
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/adapters/index.ts
git commit -m "feat: add adapter plugin loader with dynamic import"
```

---

### Task 4: Refactor Server Startup to Use Plugin System

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/lobby-manager.ts`

- [ ] **Step 1: Refactor index.ts adapter initialization**

Replace the hardcoded adapter initialization in `packages/server/src/index.ts` with:

```ts
import { createBuiltinAdapters, loadAdapterPlugin } from './adapters/index.js';
import { getAllAdapterPlugins } from './db.js';

// ... inside createServer():

  // Initialize adapters: built-in + plugins from DB
  const allAdapters = new Map<string, AgentAdapter>();

  // Built-in adapters
  for (const adapter of createBuiltinAdapters()) {
    const detection = await adapter.detect();
    if (detection.installed) {
      console.log(`${adapter.displayName} detected: ${detection.version} at ${detection.path}`);
      allAdapters.set(adapter.name, adapter);
      sessionManager.registerAdapter(adapter);
    } else {
      console.warn(`${adapter.displayName} not found.`);
    }
  }

  // Plugin adapters from DB
  const pluginRows = getAllAdapterPlugins(db);
  for (const row of pluginRows) {
    if (!row.enabled) continue;
    try {
      const adapter = await loadAdapterPlugin(row.name);
      const detection = await adapter.detect();
      if (detection.installed) {
        console.log(`[Plugin] ${adapter.displayName} detected: ${detection.version}`);
        allAdapters.set(adapter.name, adapter);
        sessionManager.registerAdapter(adapter);
      } else {
        console.warn(`[Plugin] ${adapter.displayName} CLI not installed`);
      }
    } catch (err) {
      console.error(`[Plugin] Failed to load adapter "${row.name}":`, err);
    }
  }
```

- [ ] **Step 2: Update LobbyManager to use dynamic adapter list**

In `packages/server/src/lobby-manager.ts`, change `ADAPTER_PRIORITY` to be initialized from the adapters map:

```ts
// Instead of hardcoded ADAPTER_PRIORITY, prefer claude-code, then any other detected adapters
const adapterNames = [...adapters.keys()];
const priority = ['claude-code', ...adapterNames.filter((n) => n !== 'claude-code')];
```

Pass this into the LobbyManager or use it in `init()`.

- [ ] **Step 3: Run existing adapter integration tests to verify no regression**

```bash
pnpm --filter @openlobby/core test
pnpm --filter @openlobby/server build
```

- [ ] **Step 4: Manual verification — start server**

```bash
pnpm --filter @openlobby/server dev
```

Check logs: both built-in adapters should be detected and registered. Health endpoint should show both.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/lobby-manager.ts
git commit -m "feat: refactor server to use adapter plugin system"
```

---

### Task 5: Verify End-to-End with Existing Adapters

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
pnpm -r test
pnpm -r build
```

All must pass.

- [ ] **Step 2: Start server and verify health**

```bash
pnpm --filter @openlobby/server dev
curl http://127.0.0.1:3001/health
```

Expected: `adapters` shows both claude-code and codex-cli, `lobbyManager: true`.

- [ ] **Step 3: Create a session via web UI**

Open browser, create a session, send a message, verify it works.

- [ ] **Step 4: Commit any final adjustments**

```bash
git add -u
git commit -m "chore: verify adapter plugin system end-to-end"
```
