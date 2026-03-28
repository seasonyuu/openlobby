import type { ChannelPluginModule, ChannelProviderConfig } from '@openlobby/core';
import { TelegramBotProvider } from './telegram-provider.js';

export { TelegramBotProvider } from './telegram-provider.js';
export {
  TelegramBotApi,
  splitMessage,
  escapeMarkdownV2,
  type TelegramUpdate,
  type TelegramMessage,
  type TelegramUser,
  type TelegramChat,
  type TelegramCallbackQuery,
} from './telegram-api.js';

/** OpenLobby Channel Plugin Module — auto-discovered by plugin-discovery */
const plugin: ChannelPluginModule = {
  channelName: 'telegram',
  displayName: 'Telegram',
  createProvider(config: ChannelProviderConfig) {
    return new TelegramBotProvider(config);
  },
};

export default plugin;
