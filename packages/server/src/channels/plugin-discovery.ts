import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ChannelPluginInfo } from '@openlobby/core';

const PLUGIN_PREFIX = 'openlobby-channel-';

/**
 * Discover installed channel plugins by scanning node_modules.
 * Looks for packages matching openlobby-channel-{name} or @scope/openlobby-channel-{name}.
 */
export async function discoverPlugins(): Promise<ChannelPluginInfo[]> {
  const plugins: ChannelPluginInfo[] = [];
  const nmDir = findNodeModules();
  if (!nmDir) return plugins;

  try {
    // Top-level packages: openlobby-channel-*
    const entries = readdirSync(nmDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(PLUGIN_PREFIX)) {
        const info = readPluginInfo(join(nmDir, entry.name), entry.name);
        if (info) plugins.push(info);
      }
      // Scoped packages: @scope/openlobby-channel-*
      if (entry.isDirectory() && entry.name.startsWith('@')) {
        try {
          const scopedEntries = readdirSync(join(nmDir, entry.name), { withFileTypes: true });
          for (const scoped of scopedEntries) {
            if (scoped.isDirectory() && scoped.name.startsWith(PLUGIN_PREFIX)) {
              const pkgName = `${entry.name}/${scoped.name}`;
              const info = readPluginInfo(join(nmDir, entry.name, scoped.name), pkgName);
              if (info) plugins.push(info);
            }
          }
        } catch {
          // Skip unreadable scope directories
        }
      }
    }
  } catch {
    // node_modules may not exist or be unreadable
  }

  return plugins;
}

function findNodeModules(): string | null {
  // Walk up from current working directory to find node_modules
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules');
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readPluginInfo(pkgDir: string, packageName: string): ChannelPluginInfo | null {
  try {
    const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));
    const channelName = packageName.includes('/')
      ? packageName.split('/').pop()!.replace(PLUGIN_PREFIX, '')
      : packageName.replace(PLUGIN_PREFIX, '');
    return {
      channelName,
      displayName: pkgJson.openlobby?.displayName ?? channelName,
      packageName,
      version: pkgJson.version,
    };
  } catch {
    return null;
  }
}
