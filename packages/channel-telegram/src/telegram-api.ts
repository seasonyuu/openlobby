/**
 * Lightweight Telegram Bot API client — zero external dependencies.
 * Uses native fetch (Node 18+) for HTTP requests.
 */

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: TelegramVoice;
  video?: TelegramVideo;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  chat_instance: string;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

interface ApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
}

/** Max message length for Telegram (UTF-8) */
export const MAX_MESSAGE_LENGTH = 4096;

export class TelegramBotApi {
  private baseUrl: string;

  constructor(private token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  // ─── Core API Methods ──────────────────────────────────────────

  async getMe(): Promise<TelegramUser> {
    return this.call('getMe');
  }

  async getUpdates(offset?: number, timeout = 30): Promise<TelegramUpdate[]> {
    const params: Record<string, unknown> = {
      timeout,
      allowed_updates: ['message', 'callback_query', 'edited_message'],
    };
    if (offset !== undefined) params.offset = offset;
    return this.call('getUpdates', params);
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    options?: {
      parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
      reply_markup?: InlineKeyboardMarkup;
      reply_to_message_id?: number;
      disable_web_page_preview?: boolean;
    },
  ): Promise<TelegramMessage> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      ...options,
    });
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    options?: {
      parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
      reply_markup?: InlineKeyboardMarkup;
    },
  ): Promise<TelegramMessage | true> {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...options,
    });
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    options?: { text?: string; show_alert?: boolean },
  ): Promise<boolean> {
    return this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...options,
    });
  }

  async sendChatAction(
    chatId: number | string,
    action: 'typing' | 'upload_photo' | 'upload_document' = 'typing',
  ): Promise<boolean> {
    return this.call('sendChatAction', {
      chat_id: chatId,
      action,
    });
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    return this.call('getFile', { file_id: fileId });
  }

  getFileUrl(filePath: string): string {
    return `https://api.telegram.org/file/bot${this.token}/${filePath}`;
  }

  async setWebhook(
    url: string,
    options?: {
      secret_token?: string;
      allowed_updates?: string[];
      max_connections?: number;
    },
  ): Promise<boolean> {
    return this.call('setWebhook', { url, ...options });
  }

  async deleteWebhook(): Promise<boolean> {
    return this.call('deleteWebhook');
  }

  // ─── Internal ──────────────────────────────────────────────────

  private async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: params ? JSON.stringify(params) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Telegram API ${method} HTTP ${response.status}: ${text}`);
    }

    const data = (await response.json()) as ApiResponse<T>;
    if (!data.ok) {
      throw new Error(`Telegram API ${method} failed: ${data.description ?? 'unknown error'} (code: ${data.error_code})`);
    }

    return data.result;
  }
}

/** Split text into chunks that fit within Telegram's message length limit */
export function splitMessage(text: string, maxLength = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline boundary
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt <= 0 || splitAt < maxLength * 0.3) {
      // No good newline; try space
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt <= 0 || splitAt < maxLength * 0.3) {
      // Hard split
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Escape special characters for Telegram MarkdownV2.
 * See: https://core.telegram.org/bots/api#markdownv2-style
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
