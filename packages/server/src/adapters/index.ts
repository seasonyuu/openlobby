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
