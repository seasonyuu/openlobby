# Channel Provider Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a project-level Claude Code skill that auto-generates complete IM channel provider packages for OpenLobby.

**Architecture:** Single skill file `.claude/skills/new-channel-provider.md` containing 7 phases of instructions. Phases 1-6 are fully automatic (research, scaffold, implement, build). Phase 7 is guided real-world testing — skill walks user through 8 test scenarios, asking for confirmation at each step.

**Tech Stack:** Claude Code skills (SKILL.md frontmatter format)

---

### Task 1: Create the Skill File

**Files:**
- Create: `.claude/skills/new-channel-provider.md`

- [ ] **Step 1: Create the skills directory if needed**

```bash
mkdir -p .claude/skills
```

Verify it exists (it should — `new-cli-adapter.md` is already there):

```bash
ls .claude/skills/
```

Expected: `new-cli-adapter.md` listed.

- [ ] **Step 2: Write the skill file**

Create `.claude/skills/new-channel-provider.md` with the following exact content:

````markdown
---
name: new-channel-provider
description: Generate a complete OpenLobby IM channel provider package for a new messaging platform. Triggered when the user asks to add, integrate, or support a new IM channel (e.g. Slack, Discord, Feishu, LINE, WhatsApp). Produces a pluggable channel package following the ChannelPluginModule contract.
---

# New IM Channel Provider Generator

Generate a complete OpenLobby channel provider package for a new IM platform. Follow every phase in order. Do NOT skip or reorder phases.

---

## Phase 1: Research the Target IM Platform

Before writing any code, investigate the target platform's bot/API using WebSearch and WebFetch:

1. **Bot API type** — REST API, WebSocket, SDK/library, webhook-based
2. **Authentication** — Bot token, app ID + secret, OAuth, API key
3. **Message receiving** — Long polling, webhooks, WebSocket connection
4. **Message sending** — REST POST, WebSocket frame, SDK method
5. **Message format** — Plain text, Markdown, rich cards, inline buttons/actions
6. **Callback/interaction** — Inline button callbacks, reaction events, reply threading
7. **Media support** — Image, file, voice, video upload/download APIs
8. **Rate limits** — Messages per second, message length limits, API throttling
9. **User identity** — How to identify users (user ID, chat ID, group ID)

Document your findings in a brief summary before proceeding to Phase 2.

---

## Phase 2: Scaffold the Package

Create the following structure:

```
packages/channel-<name>/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              (ChannelPluginModule export)
    ├── <name>-provider.ts    (ChannelProvider implementation)
    └── <name>-api.ts         (Lightweight API client)
```

### package.json

```json
{
  "name": "openlobby-channel-<name>",
  "version": "0.1.0",
  "description": "<DisplayName> channel plugin for OpenLobby",
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
    "dev": "tsc --watch"
  },
  "openlobby": {
    "displayName": "<DisplayName>"
  },
  "keywords": [
    "openlobby",
    "openlobby-channel",
    "<name>",
    "bot"
  ],
  "license": "MIT",
  "dependencies": {
    "@openlobby/core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^25.5.0",
    "typescript": "^5.7.0"
  }
}
```

Add platform-specific SDK as a dependency ONLY if it provides significant value over native `fetch`. Prefer zero external dependencies for the API client.

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

---

## Phase 3: Implement the API Client

Create `src/<name>-api.ts` — a lightweight, typed wrapper around the platform's HTTP/WebSocket API.

**Design principles:**
- Use native `fetch` — no external HTTP libraries
- Type all API responses (define interfaces for Message, User, Chat, etc.)
- Handle message length limits with a `splitMessage(text, maxLength)` helper
- Handle Markdown escaping if the platform has special syntax
- Export helper functions and types for the provider to use

**Required methods (adapt names/signatures to match the platform):**

```ts
export class <Name>BotApi {
  constructor(token: string) { ... }

  /** Send a text message */
  async sendMessage(chatId: string, text: string, options?: {
    format?: string;
    replyTo?: string;
  }): Promise<PlatformMessage>

  /** Send a message with inline action buttons (for tool approvals) */
  async sendMessageWithActions(chatId: string, text: string, actions: Array<{
    label: string;
    callbackData: string;
  }>): Promise<PlatformMessage>

  /** Answer a callback/interaction query (acknowledge button press) */
  async answerCallback(callbackId: string, text?: string): Promise<void>

  /** Get updates via long polling (if platform supports) */
  async getUpdates(offset?: number, timeout?: number): Promise<PlatformUpdate[]>

  /** Set webhook URL (if platform supports webhook mode) */
  async setWebhook(url: string, secret?: string): Promise<void>
}

/** Split text into chunks respecting platform message length limit */
export function splitMessage(text: string, maxLength: number): string[]
```

Reference implementation: `packages/channel-telegram/src/telegram-api.ts` (pure fetch, zero deps).

---

## Phase 4: Implement the ChannelProvider

Create `src/<name>-provider.ts` implementing the `ChannelProvider` interface from `@openlobby/core`.

### Interface to Implement

```ts
import type {
  ChannelProvider,
  ChannelRouter,
  ChannelProviderConfig,
  OutboundChannelMessage,
} from '@openlobby/core';

export class <Name>Provider implements ChannelProvider {
  readonly channelName = '<name>';
  readonly accountId: string;

  // Required
  start(router: ChannelRouter): Promise<void>;
  stop(): Promise<void>;
  sendMessage(msg: OutboundChannelMessage): Promise<void>;
  isHealthy(): boolean;

  // Optional
  updateCard?(peerId: string, taskId: string, resultText: string): Promise<void>;
  getWebhookHandlers?(): Array<{
    method: 'POST' | 'GET';
    path: string;
    handler: (request: unknown, reply: unknown) => Promise<void>;
  }>;
}
```

### Critical Patterns (MUST implement all)

**Pattern 1 — Message Receiving (choose one or both):**

Long Polling mode:
```ts
private async pollLoop(): Promise<void> {
  while (this.polling) {
    try {
      const updates = await this.api.getUpdates(this.lastUpdateId + 1, POLL_TIMEOUT);
      for (const update of updates) {
        this.lastUpdateId = Math.max(this.lastUpdateId, update.id);
        await this.processUpdate(update);
      }
    } catch (err) {
      if (!this.polling) break;
      this.log('error', 'Poll error:', err);
      await new Promise(r => setTimeout(r, ERROR_RETRY_DELAY_MS));
    }
  }
}
```

Webhook mode:
```ts
getWebhookHandlers() {
  return [{
    method: 'POST' as const,
    path: `/webhook/<name>/${this.accountId}`,
    handler: async (request: any, reply: any) => {
      // Verify signature if applicable
      await this.processUpdate(request.body);
      reply.send({ ok: true });
    },
  }];
}
```

**Pattern 2 — Inbound Message Conversion:**

```ts
private async processUpdate(update: PlatformUpdate): Promise<void> {
  // Skip duplicates
  const msgId = String(update.message?.id ?? update.id);
  if (this.isDuplicate(msgId)) return;

  // Handle callback (button press) separately
  if (update.callback) {
    const inbound: InboundChannelMessage = {
      externalMessageId: String(update.callback.id),
      identity: {
        channelName: this.channelName,
        accountId: this.accountId,
        peerId: String(update.callback.userId),
        peerDisplayName: update.callback.userName ?? undefined,
      },
      text: '',
      timestamp: Date.now(),
      callbackData: update.callback.data,
    };
    await this.router!.handleInbound(inbound);
    // Acknowledge the callback
    await this.api.answerCallback(update.callback.id);
    return;
  }

  // Regular text message
  if (!update.message?.text) return;

  const inbound: InboundChannelMessage = {
    externalMessageId: msgId,
    identity: {
      channelName: this.channelName,
      accountId: this.accountId,
      peerId: String(update.message.userId),
      peerDisplayName: update.message.userName ?? undefined,
    },
    text: update.message.text,
    timestamp: update.message.timestamp
      ? update.message.timestamp * 1000
      : Date.now(),
    // Include quote context if replying to a message
    quote: update.message.replyTo ? {
      text: update.message.replyTo.text ?? '',
      senderId: String(update.message.replyTo.userId ?? ''),
    } : undefined,
  };
  await this.router!.handleInbound(inbound);
}
```

**Pattern 3 — Outbound Message Handling (sendMessage):**

```ts
async sendMessage(msg: OutboundChannelMessage): Promise<void> {
  const chatId = msg.identity.peerId;

  switch (msg.kind) {
    case 'typing':
      // Platform-specific typing indicator
      // Some platforms: sendChatAction('typing')
      // Others: edit a placeholder message with <think> content
      break;

    case 'approval':
      // Send with inline buttons
      if (msg.actions?.length) {
        await this.api.sendMessageWithActions(chatId, msg.text, msg.actions);
      } else {
        await this.api.sendMessage(chatId, msg.text);
      }
      break;

    case 'message':
    default:
      // Split long messages if needed
      const chunks = splitMessage(msg.text, MAX_MESSAGE_LENGTH);
      for (const chunk of chunks) {
        await this.api.sendMessage(chatId, chunk, {
          format: msg.format ?? 'text',
        });
      }
      break;
  }
}
```

**Pattern 4 — Message Deduplication:**

```ts
private seenMessages = new Map<string, number>();
private dedupTimer: ReturnType<typeof setInterval> | null = null;

private isDuplicate(msgId: string): boolean {
  if (this.seenMessages.has(msgId)) return true;
  this.seenMessages.set(msgId, Date.now());
  return false;
}

// In start(): set up cleanup
this.dedupTimer = setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [id, ts] of this.seenMessages) {
    if (ts < cutoff) this.seenMessages.delete(id);
  }
}, 60_000);
```

**Pattern 5 — Debug Logging:**

```ts
debugLogs: string[] = [];
private maxDebugLogs = 50;

private log(level: 'info' | 'warn' | 'error', ...args: unknown[]) {
  const prefix = `[<Name>:${this.accountId}]`;
  const line = `${new Date().toISOString()} ${level} ${args.map(
    a => typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ')}`;
  this.debugLogs.push(line);
  if (this.debugLogs.length > this.maxDebugLogs) this.debugLogs.shift();
  if (level === 'error') console.error(prefix, ...args);
  else if (level === 'warn') console.warn(prefix, ...args);
  else console.log(prefix, ...args);
}
```

**Pattern 6 — Graceful Shutdown:**

```ts
async stop(): Promise<void> {
  this.polling = false;
  this.pollAbort?.abort();
  if (this.dedupTimer) clearInterval(this.dedupTimer);
  for (const timer of this.typingTimers.values()) clearInterval(timer);
  this.typingTimers.clear();
  this.healthy = false;
  this.log('info', 'Provider stopped');
}
```

**Pattern 7 — Health Check:**

```ts
isHealthy(): boolean {
  return this.healthy;
}
// Set this.healthy = true after successful auth/connection in start()
// Set this.healthy = false on disconnect/error
```

### Existing Provider Reference

| Aspect | WeCom (built-in) | Telegram (plugin) |
|--------|-------------------|-------------------|
| Location | `packages/server/src/channels/wecom.ts` | `packages/channel-telegram/` |
| API client | `@wecom/aibot-node-sdk` (WebSocket) | Pure `fetch` (zero deps) |
| Receiving | WebSocket events | Long polling / Webhook |
| Sending | WebSocket stream reply | REST `sendMessage` |
| Typing | `<think>` tags in stream | `sendChatAction('typing')` |
| Approvals | Stream reply (no inline buttons) | Inline keyboard buttons |
| Message limit | 20,480 bytes | 4,096 chars |
| Auth | botId + secret | botToken |

### Credentials Reference

```
WeCom:    { botId, secret }
Telegram: { botToken, webhookUrl?, webhookSecret? }
Slack:    { botToken, signingSecret }
Discord:  { botToken, applicationId }
Feishu:   { appId, appSecret }
LINE:     { channelAccessToken, channelSecret }
WhatsApp: { accessToken, phoneNumberId, verifyToken }
```

---

## Phase 5: Implement the Plugin Entry Point

Create `src/index.ts`:

```ts
import type { ChannelPluginModule, ChannelProviderConfig } from '@openlobby/core';
import { <Name>Provider } from './<name>-provider.js';

export { <Name>Provider } from './<name>-provider.js';
export { <Name>BotApi, splitMessage } from './<name>-api.js';

/** OpenLobby Channel Plugin Module — auto-discovered by plugin-discovery */
const plugin: ChannelPluginModule = {
  channelName: '<name>',
  displayName: '<DisplayName>',
  createProvider(config: ChannelProviderConfig) {
    return new <Name>Provider(config);
  },
};

export default plugin;
```

---

## Phase 6: Auto-Verify (Hard Gate)

```bash
pnpm install
pnpm --filter openlobby-channel-<name> build
```

Build MUST pass with zero TypeScript errors. If it fails, fix and rebuild.

Then verify the plugin structure:
1. Default export has `channelName` (string), `displayName` (string), `createProvider` (function)
2. `createProvider(config)` returns an object with `start`, `stop`, `sendMessage`, `isHealthy` methods
3. `channelName` matches the package name convention (`openlobby-channel-<name>`)

Do NOT proceed to Phase 7 until build passes and structure is verified.

---

## Phase 7: Guided Real-World Testing

Now test with real credentials. Ask the user to provide bot credentials, then walk through each test one by one.

**Before starting:** Tell the user:
> "Build passed! Now let's test with a real bot. I need the credentials for your <DisplayName> bot. Please provide them (I'll configure the provider via the Web UI or API)."

Wait for user to provide credentials.

### T1: Provider Startup

1. Start the server: `pnpm --filter @openlobby/server dev`
2. Configure the provider (via Web UI "IM Channels" panel or curl):
   ```bash
   curl -X POST http://127.0.0.1:3002/api/channels/providers \
     -H 'Content-Type: application/json' \
     -d '{"channelName":"<name>","accountId":"<bot-id>","credentials":{...},"enabled":true}'
   ```
3. Check health: `curl http://127.0.0.1:3001/health`
4. Ask user: **"Does the health endpoint show the new provider as `healthy: true`? (yes/no)"**

### T2: Receive Message

1. Tell user: **"Send the word `hello` to the bot from <DisplayName>."**
2. Watch server logs for `[ChannelRouter] Inbound from`
3. Ask user: **"Did the message arrive? Check if you see a response from the Lobby Manager. (yes/no)"**

### T3: Send Response

1. The LM should have routed and responded.
2. Ask user: **"Did the bot reply in <DisplayName> with a response? (yes/no)"**

### T4: Approval Card

1. Tell user: **"Send a message like 'create a file called test.txt' to trigger a tool that needs approval."**
2. Ask user: **"Do you see inline approve/deny buttons in <DisplayName>? Try clicking one. (yes/no)"**

### T5: Slash Commands — /help

1. Tell user: **"Send `/help` to the bot."**
2. Ask user: **"Did the bot return a list of available commands? (yes/no)"**

### T6: Slash Commands — /ls and /exit

1. Tell user: **"Send `/ls` to see sessions, then `/exit` to return to Lobby Manager."**
2. Ask user: **"Did `/ls` show sessions and `/exit` confirm return to LM? (yes/no)"**

### T7: Multi-Turn Conversation

1. Tell user: **"Have a short conversation — send 3 messages in sequence to the bot."**
2. Ask user: **"Did all 3 messages get responses? Was the conversation coherent? (yes/no)"**

### T8: Typing Indicator

1. Tell user: **"Send a complex question that takes a few seconds to answer."**
2. Ask user: **"Did you see a typing/thinking indicator before the response arrived? (yes/no)"**

**For each failed test:** Help diagnose by checking:
- Server logs: `tail -50 /tmp/openlobby-server.log`
- Debug logs: `curl http://127.0.0.1:3001/debug/channel-logs`
- Provider code for bugs
- Fix, rebuild, restart, and re-test.

**After all 8 tests pass:** Report success:
> "All 8 tests passed! The <DisplayName> channel provider is fully working. Package: `packages/channel-<name>/`"
````

- [ ] **Step 3: Verify the file is syntactically valid**

```bash
head -4 .claude/skills/new-channel-provider.md
```

Expected output:
```
---
name: new-channel-provider
description: Generate a complete OpenLobby IM channel provider package for a new messaging platform. Triggered when the user asks to add, integrate, or support a new IM channel (e.g. Slack, Discord, Feishu, LINE, WhatsApp). Produces a pluggable channel package following the ChannelPluginModule contract.
---
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/new-channel-provider.md
git commit -m "feat: add new-channel-provider skill for Claude Code"
```

---

### Task 2: Update CLAUDE.md to Reference the New Skill

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the skill reference to Workflow Rules**

In `CLAUDE.md`, find the line:
```
- Use project skill `/new-cli-adapter` to generate new Agentic CLI adapter packages
```

Add after it:
```
- Use project skill `/new-channel-provider` to generate new IM channel provider packages
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: reference new-channel-provider skill in CLAUDE.md"
```

---

### Task 3: Verify Skill Is Discoverable

**Files:** None (verification only)

- [ ] **Step 1: List skills directory**

```bash
ls -la .claude/skills/
```

Expected: Both `new-cli-adapter.md` and `new-channel-provider.md` listed.

- [ ] **Step 2: Verify frontmatter**

```bash
head -4 .claude/skills/new-channel-provider.md
```

Expected: Valid YAML frontmatter with `name: new-channel-provider` and `description: ...`.

- [ ] **Step 3: Check file size is reasonable**

```bash
wc -l .claude/skills/new-channel-provider.md
```

Expected: 300-400 lines (comprehensive but not bloated).
