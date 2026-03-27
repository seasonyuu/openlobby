import { WSClient, generateReqId } from '@wecom/aibot-node-sdk';
import type { WsFrameHeaders } from '@wecom/aibot-node-sdk';
import type {
  ChannelProvider,
  ChannelRouter,
  ChannelProviderConfig,
  OutboundChannelMessage,
} from '@openlobby/core';
import { randomUUID } from 'node:crypto';

/** Max text length for WeCom stream reply (20480 bytes) */
const MAX_REPLY_BYTES = 20_000;
/** Message dedup TTL (5 minutes) */
const DEDUP_TTL_MS = 5 * 60 * 1000;

interface PendingReply {
  frame: WsFrameHeaders;
  streamId: string;
}

export class WeComBotProvider implements ChannelProvider {
  readonly channelName = 'wecom';
  readonly accountId: string;

  private client: WSClient;
  private router: ChannelRouter | null = null;
  private healthy = false;

  /** Map peerId → pending reply context (frame + streamId) for ws-based replies */
  private pendingReplies = new Map<string, PendingReply>();
  /** Message dedup set: msgid → timestamp */
  private seenMessages = new Map<string, number>();
  /** Cleanup timer */
  private dedupTimer: ReturnType<typeof setInterval> | null = null;
  /** Health check timer */
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  /** Consecutive reconnect attempts (for backoff) */
  private reconnectAttempts = 0;

  /** Recent debug logs (ring buffer) */
  debugLogs: string[] = [];
  private maxDebugLogs = 50;

  private log(level: 'info' | 'warn' | 'error', ...args: unknown[]) {
    const prefix = `[WeCom:${this.accountId}]`;
    const line = `${new Date().toISOString()} ${level} ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
    this.debugLogs.push(line);
    if (this.debugLogs.length > this.maxDebugLogs) this.debugLogs.shift();
    if (level === 'error') console.error(prefix, ...args);
    else if (level === 'warn') console.warn(prefix, ...args);
    else console.log(prefix, ...args);
  }

  constructor(config: ChannelProviderConfig) {
    this.accountId = config.accountId;
    this.log('info', 'Creating WSClient with botId:', config.credentials.botId);
    this.client = new WSClient({
      botId: config.credentials.botId,
      secret: config.credentials.secret,
      maxReconnectAttempts: -1, // infinite reconnect
    });
  }

  async start(router: ChannelRouter): Promise<void> {
    this.router = router;
    this.log('info', 'Starting provider...');

    // Connection lifecycle events
    this.client.on('connected', () => {
      this.log('info', 'WebSocket connected, waiting for authentication...');
    });

    this.client.on('authenticated', () => {
      this.healthy = true;
      this.reconnectAttempts = 0;
      this.log('info', 'Authenticated successfully! Ready to receive messages.');
    });

    this.client.on('disconnected', (reason) => {
      this.healthy = false;
      this.log('warn', 'Disconnected:', reason);
    });

    this.client.on('reconnecting', (attempt) => {
      this.log('info', `Reconnecting (attempt ${attempt})...`);
    });

    this.client.on('error', (err) => {
      this.log('error', 'SDK error:', err.message);
    });

    // Listen for ALL messages first (for debugging)
    this.client.on('message', (frame) => {
      this.log('info', 'Received message:', frame.body?.msgtype, 'from:', frame.body?.from?.userid, 'msgid:', frame.body?.msgid);
    });

    // Text messages
    this.client.on('message.text', (frame) => {
      this.log('info', 'Text message handler fired');
      if (!frame.body) {
        this.log('warn', 'Text message has no body');
        return;
      }
      const body = frame.body;
      if (this.isDuplicate(body.msgid)) {
        this.log('info', 'Duplicate message, skipping:', body.msgid);
        return;
      }

      const peerId = body.from.userid;
      this.log('info', `Text from ${peerId}: "${body.text.content}"`);

      // Store frame for reply context
      this.pendingReplies.set(peerId, {
        frame: { headers: frame.headers },
        streamId: generateReqId('stream'),
      });

      // Detect quote/reply message
      const quote = parseQuoteMessage(body);
      const messageText = quote
        ? `> ${quote.text}\n\n${body.text.content}`
        : body.text.content;

      router.handleInbound({
        externalMessageId: body.msgid,
        identity: {
          channelName: 'wecom',
          accountId: this.accountId,
          peerId,
        },
        text: messageText,
        timestamp: (body.create_time ?? Date.now() / 1000) * 1000,
        quote: quote ?? undefined,
        raw: frame,
      }).catch((err) => this.log('error', 'handleInbound error:', err));
    });

    // Voice messages (use transcription)
    this.client.on('message.voice', (frame) => {
      if (!frame.body) return;
      const body = frame.body;
      if (this.isDuplicate(body.msgid)) return;

      const peerId = body.from.userid;
      this.log('info', `Voice from ${peerId}: "${body.voice.content}"`);

      this.pendingReplies.set(peerId, {
        frame: { headers: frame.headers },
        streamId: generateReqId('stream'),
      });

      router.handleInbound({
        externalMessageId: body.msgid,
        identity: {
          channelName: 'wecom',
          accountId: this.accountId,
          peerId,
        },
        text: body.voice.content || '[语音消息]',
        timestamp: (body.create_time ?? Date.now() / 1000) * 1000,
        raw: frame,
      }).catch((err) => this.log('error', 'voice handleInbound error:', err));
    });

    // Image messages
    this.client.on('message.image', (frame) => {
      if (!frame.body) return;
      const body = frame.body;
      if (this.isDuplicate(body.msgid)) return;

      const peerId = body.from.userid;
      this.log('info', `Image from ${peerId}`);

      this.pendingReplies.set(peerId, {
        frame: { headers: frame.headers },
        streamId: generateReqId('stream'),
      });

      const imageUrl = body.image?.url || (body.image as any)?.media_id;
      router.handleInbound({
        externalMessageId: body.msgid,
        identity: {
          channelName: 'wecom',
          accountId: this.accountId,
          peerId,
        },
        text: '[图片]',
        timestamp: (body.create_time ?? Date.now() / 1000) * 1000,
        attachments: imageUrl ? [{ type: 'image', url: imageUrl }] : undefined,
        raw: frame,
      }).catch((err) => this.log('error', 'image handleInbound error:', err));
    });

    // Mixed content messages (图文混排)
    this.client.on('message.mixed', (frame) => {
      if (!frame.body) return;
      const body = frame.body;
      if (this.isDuplicate(body.msgid)) return;

      const peerId = body.from.userid;
      this.log('info', `Mixed message from ${peerId}`);

      this.pendingReplies.set(peerId, {
        frame: { headers: frame.headers },
        streamId: generateReqId('stream'),
      });

      const { text, attachments } = parseMixedContent(body);

      router.handleInbound({
        externalMessageId: body.msgid,
        identity: {
          channelName: 'wecom',
          accountId: this.accountId,
          peerId,
        },
        text: text || '[图文消息]',
        timestamp: (body.create_time ?? Date.now() / 1000) * 1000,
        attachments: attachments.length > 0 ? attachments : undefined,
        raw: frame,
      }).catch((err) => this.log('error', 'mixed handleInbound error:', err));
    });

    // Template card events (inline approval callbacks)
    this.client.on('event.template_card_event', (frame) => {
      if (!frame.body) return;
      const body = frame.body as Record<string, any>;
      this.log('info', `Card event raw body: ${JSON.stringify(body).slice(0, 800)}`);

      // WeCom nests card data in body.event.template_card_event
      const event = body.event ?? {};
      const cardEvent = event.template_card_event ?? event;
      const eventKey: string | undefined = cardEvent.event_key ?? event.event_key;
      const taskId: string | undefined = cardEvent.task_id ?? event.task_id;
      const peerId: string = body.from?.userid;

      this.log('info', `Card event parsed: peerId=${peerId} key=${eventKey} task=${taskId}`);

      if (eventKey && peerId) {
        if (taskId) {
          this.pendingReplies.set(`card:${peerId}:${taskId}`, {
            frame: { headers: frame.headers },
            streamId: '',
          });
        }

        router.handleInbound({
          externalMessageId: body.msgid ?? '',
          identity: {
            channelName: 'wecom',
            accountId: this.accountId,
            peerId,
          },
          text: '',
          timestamp: (body.create_time ?? Date.now() / 1000) * 1000,
          callbackData: eventKey,
          raw: frame,
        }).catch((err) => this.log('error', 'card event error:', err));
      } else {
        this.log('warn', 'Card event missing event_key or peerId, ignoring');
      }
    });

    // Also listen for all events (debugging)
    this.client.on('event', (frame) => {
      this.log('info', 'Event received:', frame.body?.event?.eventtype);
    });

    // Start connection
    this.client.connect();

    // Start dedup cleanup
    this.dedupTimer = setInterval(() => this.cleanupDedup(), 60_000);

    // Start periodic health check for auto-reconnect
    this.healthCheckTimer = setInterval(() => this.healthCheck(), 30_000);

    this.log('info', 'Provider started, connecting to WeCom...');
  }

  async stop(): Promise<void> {
    if (this.dedupTimer) {
      clearInterval(this.dedupTimer);
      this.dedupTimer = null;
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    this.client.disconnect();
    this.healthy = false;
    this.pendingReplies.clear();
    this.log('info', 'Provider stopped');
  }

  isHealthy(): boolean {
    return this.healthy && this.client.isConnected;
  }

  async updateCard(peerId: string, taskId: string, resultText: string): Promise<void> {
    const key = `card:${peerId}:${taskId}`;
    const pending = this.pendingReplies.get(key);
    if (!pending) {
      this.log('warn', `No pending card frame for ${key}`);
      return;
    }

    try {
      await this.client.updateTemplateCard(pending.frame, {
        card_type: 'text_notice',
        main_title: { title: resultText },
        task_id: taskId,
      });
      this.log('info', `Card updated: ${taskId} → ${resultText}`);
    } catch (err) {
      this.log('error', 'updateCard error:', err);
    }
    this.pendingReplies.delete(key);
  }

  async sendMessage(msg: OutboundChannelMessage): Promise<void> {
    const peerId = msg.identity.peerId;
    this.log('info', `sendMessage kind=${msg.kind ?? 'message'} to=${peerId} text=${msg.text.slice(0, 80)}...`);

    switch (msg.kind) {
      case 'typing': {
        const pending = this.pendingReplies.get(peerId);
        if (pending) {
          try {
            await this.client.replyStream(
              pending.frame,
              pending.streamId,
              msg.text,
              false,
            );
          } catch (err) {
            this.log('error', 'typing stream error:', err);
          }
        } else {
          this.log('warn', 'No pending frame for typing, skipping');
        }
        break;
      }

      case 'approval': {
        // Extract taskId from the first action's callbackData (format: action:sessionId:requestId:taskId)
        const firstAction = msg.actions?.[0]?.callbackData ?? '';
        const taskId = firstAction.split(':')[3] || `approval_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
        const buttons = (msg.actions ?? []).map((a, i) => ({
          text: a.label,
          style: i === 0 ? 1 : 2,
          key: a.callbackData,
        }));

        const pending = this.pendingReplies.get(peerId);
        if (pending) {
          try {
            await this.client.replyTemplateCard(pending.frame, {
              card_type: 'button_interaction',
              main_title: { title: '工具调用审批' },
              sub_title_text: msg.text,
              button_list: buttons,
              task_id: taskId,
            });
            this.pendingReplies.delete(peerId);
          } catch (err) {
            this.log('error', 'approval card reply error:', err);
            await this.sendViaApi(peerId, msg);
          }
        } else {
          await this.sendViaApi(peerId, msg);
        }
        break;
      }

      case 'message':
      default: {
        // Parse media directives (MEDIA:<path>, FILE:<path>)
        const { cleanText: messageText, mediaPaths } = parseMediaDirectives(msg.text);
        if (mediaPaths.length > 0) {
          this.log('info', `Found ${mediaPaths.length} media directive(s), paths: ${mediaPaths.map(m => m.path).join(', ')}`);
        }
        const effectiveText = messageText || msg.text;

        const pending = this.pendingReplies.get(peerId);
        if (pending) {
          try {
            const chunks = splitText(effectiveText, MAX_REPLY_BYTES);
            for (let i = 0; i < chunks.length; i++) {
              const isLast = i === chunks.length - 1;
              await this.client.replyStream(pending.frame, pending.streamId, chunks[i], isLast);
            }
            // Regenerate streamId so subsequent typing can start a new stream
            // (keep the frame alive for follow-up think messages)
            pending.streamId = generateReqId('stream');
            this.log('info', 'Reply sent via stream, new streamId ready');
          } catch (err) {
            this.log('error', 'stream reply error, falling back to sendMessage API:', err);
            this.pendingReplies.delete(peerId);
            await this.sendViaApi(peerId, msg);
          }
        } else {
          this.log('info', 'No pending frame, using sendMessage API');
          await this.sendViaApi(peerId, msg);
        }
        break;
      }
    }
  }

  /** Proactive send via WeCom API (sendMessage) */
  private async sendViaApi(peerId: string, msg: OutboundChannelMessage): Promise<void> {
    try {
      const chunks = splitText(msg.text, MAX_REPLY_BYTES);
      for (const chunk of chunks) {
        if (msg.kind === 'approval' && msg.actions?.length) {
          const firstAction = msg.actions[0].callbackData;
          const taskId = firstAction.split(':')[3] || `approval_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
          await this.client.sendMessage(peerId, {
            msgtype: 'template_card',
            template_card: {
              card_type: 'button_interaction',
              main_title: { title: '工具调用审批' },
              sub_title_text: chunk,
              button_list: msg.actions.map((a, i) => ({
                text: a.label,
                style: i === 0 ? 1 : 2,
                key: a.callbackData,
              })),
              task_id: taskId,
            },
          });
        } else {
          await this.client.sendMessage(peerId, {
            msgtype: 'markdown',
            markdown: { content: chunk },
          });
        }
      }
      this.log('info', 'Message sent via API');
    } catch (err) {
      this.log('error', 'sendViaApi failed:', err);
    }
  }

  getWebhookHandlers() {
    return [];
  }

  private healthCheck(): void {
    if (this.healthy && this.client.isConnected) {
      this.reconnectAttempts = 0;
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff: skip this check if not enough intervals have passed
    // backoff intervals: 1, 2, 4, 8... (capped at 10 = ~5min at 30s interval)
    const backoffMultiplier = Math.min(Math.pow(2, this.reconnectAttempts - 1), 10);
    if (this.reconnectAttempts > 1 && this.reconnectAttempts % backoffMultiplier !== 0) {
      return;
    }

    this.log('info', `Health check: unhealthy (attempt ${this.reconnectAttempts}), attempting reconnect...`);
    try {
      this.client.connect();
    } catch (err) {
      this.log('error', 'Reconnect failed:', err instanceof Error ? err.message : String(err));
    }
  }

  private isDuplicate(msgId: string): boolean {
    if (this.seenMessages.has(msgId)) return true;
    this.seenMessages.set(msgId, Date.now());
    return false;
  }

  private cleanupDedup(): void {
    const cutoff = Date.now() - DEDUP_TTL_MS;
    for (const [key, ts] of this.seenMessages) {
      if (ts < cutoff) this.seenMessages.delete(key);
    }
  }
}

/** Parse mixed content message into text + image attachments */
function parseMixedContent(body: Record<string, any>): {
  text: string;
  attachments: Array<{ type: 'image' | 'file'; url?: string; filename?: string }>;
} {
  const textParts: string[] = [];
  const attachments: Array<{ type: 'image' | 'file'; url?: string; filename?: string }> = [];

  // WeCom mixed messages may have items in body.mixed.items or body.content
  const items: any[] = body.mixed?.items ?? body.content?.items ?? [];
  for (const item of items) {
    if (item.type === 'text' && item.content) {
      textParts.push(item.content);
    } else if (item.type === 'image') {
      const url = item.url ?? item.media_id;
      if (url) attachments.push({ type: 'image', url });
    } else if (item.type === 'file') {
      attachments.push({
        type: 'file',
        url: item.url ?? item.media_id,
        filename: item.filename,
      });
    }
  }

  return { text: textParts.join('\n'), attachments };
}

/** Extract quote/reply context from a WeCom text message */
function parseQuoteMessage(body: Record<string, any>): {
  text: string;
  senderId?: string;
  timestamp?: number;
} | null {
  // WeCom quote messages include a quote field in the body
  const quote = body.text?.quote ?? body.quote;
  if (!quote) return null;

  return {
    text: typeof quote === 'string' ? quote : (quote.content ?? quote.text ?? ''),
    senderId: quote.from?.userid,
    timestamp: quote.create_time ? quote.create_time * 1000 : undefined,
  };
}

/** Parse MEDIA: and FILE: directives from outbound text */
function parseMediaDirectives(text: string): {
  cleanText: string;
  mediaPaths: Array<{ type: 'media' | 'file'; path: string }>;
} {
  const mediaPaths: Array<{ type: 'media' | 'file'; path: string }> = [];
  const cleanText = text.replace(/(?:MEDIA|FILE):(\S+)/g, (match, path) => {
    mediaPaths.push({
      type: match.startsWith('FILE') ? 'file' : 'media',
      path,
    });
    return '';
  }).trim();
  return { cleanText, mediaPaths };
}

/** Split text into chunks that fit within byte limit */
function splitText(text: string, maxBytes: number): string[] {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(text);
  if (encoded.byteLength <= maxBytes) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = text.length;
    while (encoder.encode(text.slice(start, end)).byteLength > maxBytes) {
      end = Math.floor((start + end) / 2);
    }
    while (end < text.length && encoder.encode(text.slice(start, end + 1)).byteLength <= maxBytes) {
      end++;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}
