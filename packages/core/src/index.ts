export type {
  LobbyMessage,
  SpawnOptions,
  ResumeOptions,
  ControlDecision,
  ControlRequest,
  AgentProcess,
  SessionSummary,
  AgentAdapter,
  AdapterCommand,
  McpServerConfig,
} from './types.js';

export type { ClientMessage, ServerMessage } from './protocol.js';

export type {
  ChannelIdentity,
  ChannelIdentityKey,
  InboundChannelMessage,
  OutboundChannelMessage,
  ChannelProviderConfig,
  ChannelProviderInfo,
  ChannelBinding,
  ChannelProvider,
  ChannelRouter,
  ChannelPluginModule,
  ChannelPluginInfo,
} from './channel.js';
export { toIdentityKey } from './channel.js';

export { ClaudeCodeAdapter, CodexCliAdapter } from './adapters/index.js';
