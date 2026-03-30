import type { ChannelProvider, ChannelProviderConfig, ChannelPluginModule } from '@openlobby/core';
import { WeComBotProvider } from './wecom.js';
import { TelegramBotProvider } from 'openlobby-channel-telegram';

/**
 * Create a channel provider from config.
 * Checks built-in providers first, then tries dynamic import from npm packages.
 */
export async function createProvider(config: ChannelProviderConfig): Promise<ChannelProvider> {
  // Built-in providers
  switch (config.channelName) {
    case 'wecom':
      return new WeComBotProvider(config);
    case 'telegram':
      return new TelegramBotProvider(config);
  }

  // Dynamic plugin: try npm package conventions
  const plugin = await loadChannelPlugin(config.channelName);
  return plugin.createProvider(config);
}

/**
 * Attempt to dynamically load a channel plugin by name.
 * Tries: openlobby-channel-{name}, @openlobby/channel-{name}
 */
async function loadChannelPlugin(channelName: string): Promise<ChannelPluginModule> {
  const candidates = [
    `openlobby-channel-${channelName}`,
    `@openlobby/channel-${channelName}`,
  ];

  for (const pkg of candidates) {
    try {
      const mod = await import(pkg);
      const plugin: ChannelPluginModule = mod.default ?? mod;
      if (typeof plugin.createProvider !== 'function') {
        throw new Error(`Plugin ${pkg} does not export a createProvider function`);
      }
      return plugin;
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
        continue; // Try next candidate
      }
      throw err; // Re-throw non-resolution errors
    }
  }

  throw new Error(
    `No channel plugin found for "${channelName}". ` +
    `Install one of: ${candidates.join(', ')}`,
  );
}

export { WeComBotProvider } from './wecom.js';
