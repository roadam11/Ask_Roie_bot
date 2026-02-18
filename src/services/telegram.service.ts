/**
 * Telegram Service
 *
 * Handles all Telegram Bot API interactions including
 * sending messages and processing updates.
 *
 * Key differences from WhatsApp:
 * - No 24-hour window restrictions
 * - Simpler message format
 * - Free forever, no credentials issues
 * - Uses chat_id instead of phone number
 *
 * @example
 * import * as TelegramService from './services/telegram.service.js';
 *
 * await TelegramService.sendMessage('123456789', 'Hello!');
 */

import axios, { AxiosError } from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Telegram Update object (incoming webhook payload)
 */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/**
 * Telegram Message object
 */
export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: TelegramVoice;
  contact?: TelegramContact;
  location?: TelegramLocation;
  reply_to_message?: TelegramMessage;
}

/**
 * Telegram User object
 */
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Telegram Chat object
 */
export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/**
 * Telegram Callback Query (for inline keyboards)
 */
export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  chat_instance: string;
  data?: string;
}

/**
 * Telegram Photo Size
 */
interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

/**
 * Telegram Document
 */
interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/**
 * Telegram Voice
 */
interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

/**
 * Telegram Contact
 */
interface TelegramContact {
  phone_number: string;
  first_name: string;
  last_name?: string;
  user_id?: number;
}

/**
 * Telegram Location
 */
interface TelegramLocation {
  longitude: number;
  latitude: number;
}

/**
 * Telegram Inline Keyboard Button
 */
export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

/**
 * Telegram Reply Keyboard Button
 */
export interface TelegramKeyboardButton {
  text: string;
  request_contact?: boolean;
  request_location?: boolean;
}

/**
 * Telegram API Response
 */
interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

// ============================================================================
// API Client Setup
// ============================================================================

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Telegram API client
 */
const telegramApi = axios.create({
  baseURL: `${TELEGRAM_API_BASE}/bot${config.telegram.botToken}`,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// ============================================================================
// Message Sending
// ============================================================================

/**
 * Send a text message via Telegram
 *
 * @param chatId - Telegram chat ID
 * @param text - Message text (supports Markdown)
 * @param options - Additional options
 * @returns Telegram message ID
 */
export async function sendMessage(
  chatId: string | number,
  text: string,
  options?: {
    parseMode?: 'Markdown' | 'HTML';
    disableWebPagePreview?: boolean;
    replyToMessageId?: number;
    replyMarkup?: {
      inline_keyboard?: TelegramInlineKeyboardButton[][];
      keyboard?: TelegramKeyboardButton[][];
      remove_keyboard?: boolean;
      one_time_keyboard?: boolean;
      resize_keyboard?: boolean;
    };
  }
): Promise<number> {
  const startTime = Date.now();

  try {
    // Truncate text if too long (Telegram limit is 4096 chars)
    const truncatedText = text.length > 4096 ? text.substring(0, 4093) + '...' : text;

    const response = await telegramApi.post<TelegramApiResponse<TelegramMessage>>(
      '/sendMessage',
      {
        chat_id: chatId,
        text: truncatedText,
        parse_mode: options?.parseMode,
        disable_web_page_preview: options?.disableWebPagePreview,
        reply_to_message_id: options?.replyToMessageId,
        reply_markup: options?.replyMarkup,
      }
    );

    const duration = Date.now() - startTime;
    const messageId = response.data.result?.message_id;

    logger.info('Telegram message sent', {
      chatId: maskChatId(String(chatId)),
      messageId,
      textLength: truncatedText.length,
      duration,
    });

    return messageId || 0;
  } catch (error) {
    handleTelegramError(error, 'sendMessage', String(chatId));
    throw error;
  }
}

/**
 * Send a message with inline keyboard buttons
 *
 * @param chatId - Telegram chat ID
 * @param text - Message text
 * @param buttons - Array of button rows
 */
export async function sendMessageWithButtons(
  chatId: string | number,
  text: string,
  buttons: Array<Array<{ text: string; callbackData?: string; url?: string }>>
): Promise<number> {
  const inlineKeyboard = buttons.map((row) =>
    row.map((btn) => ({
      text: btn.text,
      callback_data: btn.callbackData,
      url: btn.url,
    }))
  );

  return sendMessage(chatId, text, {
    replyMarkup: { inline_keyboard: inlineKeyboard },
  });
}

/**
 * Answer a callback query (acknowledge button press)
 *
 * @param callbackQueryId - Callback query ID
 * @param options - Response options
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  options?: {
    text?: string;
    showAlert?: boolean;
  }
): Promise<void> {
  try {
    await telegramApi.post('/answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: options?.text,
      show_alert: options?.showAlert,
    });
  } catch (error) {
    logger.warn('Failed to answer callback query', {
      callbackQueryId,
      error: (error as Error).message,
    });
  }
}

/**
 * Send typing action (shows "typing..." in chat)
 *
 * @param chatId - Telegram chat ID
 */
export async function sendTypingAction(chatId: string | number): Promise<void> {
  try {
    await telegramApi.post('/sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    });
  } catch (error) {
    // Don't throw - typing action is not critical
    logger.debug('Failed to send typing action', {
      chatId: maskChatId(String(chatId)),
    });
  }
}

/**
 * Edit an existing message
 *
 * @param chatId - Telegram chat ID
 * @param messageId - Message ID to edit
 * @param text - New text
 */
export async function editMessage(
  chatId: string | number,
  messageId: number,
  text: string,
  options?: {
    parseMode?: 'Markdown' | 'HTML';
    replyMarkup?: { inline_keyboard?: TelegramInlineKeyboardButton[][] };
  }
): Promise<void> {
  try {
    await telegramApi.post('/editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options?.parseMode,
      reply_markup: options?.replyMarkup,
    });
  } catch (error) {
    handleTelegramError(error, 'editMessage', String(chatId));
    throw error;
  }
}

/**
 * Delete a message
 *
 * @param chatId - Telegram chat ID
 * @param messageId - Message ID to delete
 */
export async function deleteMessage(
  chatId: string | number,
  messageId: number
): Promise<void> {
  try {
    await telegramApi.post('/deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    });
  } catch (error) {
    logger.warn('Failed to delete message', {
      chatId: maskChatId(String(chatId)),
      messageId,
      error: (error as Error).message,
    });
  }
}

// ============================================================================
// Webhook Management
// ============================================================================

/**
 * Set webhook URL for receiving updates
 *
 * @param url - Webhook URL (must be HTTPS)
 */
export async function setWebhook(url: string): Promise<boolean> {
  try {
    const response = await telegramApi.post<TelegramApiResponse<boolean>>(
      '/setWebhook',
      {
        url,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false,
      }
    );

    if (response.data.ok) {
      logger.info('Telegram webhook set', { url });
      return true;
    } else {
      logger.error('Failed to set Telegram webhook', {
        description: response.data.description,
      });
      return false;
    }
  } catch (error) {
    handleTelegramError(error, 'setWebhook', '');
    return false;
  }
}

/**
 * Remove webhook
 */
export async function deleteWebhook(): Promise<boolean> {
  try {
    const response = await telegramApi.post<TelegramApiResponse<boolean>>(
      '/deleteWebhook',
      { drop_pending_updates: false }
    );
    return response.data.ok;
  } catch (error) {
    handleTelegramError(error, 'deleteWebhook', '');
    return false;
  }
}

/**
 * Get current webhook info
 */
export async function getWebhookInfo(): Promise<{
  url: string;
  pendingUpdateCount: number;
  lastErrorDate?: number;
  lastErrorMessage?: string;
} | null> {
  try {
    const response = await telegramApi.get<TelegramApiResponse<{
      url: string;
      pending_update_count: number;
      last_error_date?: number;
      last_error_message?: string;
    }>>('/getWebhookInfo');

    if (response.data.ok && response.data.result) {
      return {
        url: response.data.result.url,
        pendingUpdateCount: response.data.result.pending_update_count,
        lastErrorDate: response.data.result.last_error_date,
        lastErrorMessage: response.data.result.last_error_message,
      };
    }
    return null;
  } catch (error) {
    handleTelegramError(error, 'getWebhookInfo', '');
    return null;
  }
}

// ============================================================================
// Update Parsing
// ============================================================================

/**
 * Parse incoming Telegram update
 *
 * @param update - Raw Telegram update object
 * @returns Parsed message data or null
 */
export function parseUpdate(update: TelegramUpdate): {
  chatId: string;
  messageId: number;
  text: string | null;
  userId: number;
  userName: string | null;
  firstName: string | null;
  lastName: string | null;
  isCallback: boolean;
  callbackQueryId?: string;
  callbackData?: string;
} | null {
  // Handle callback query (button press)
  if (update.callback_query) {
    const query = update.callback_query;
    return {
      chatId: String(query.message?.chat.id || query.from.id),
      messageId: query.message?.message_id || 0,
      text: query.data || null,
      userId: query.from.id,
      userName: query.from.username || null,
      firstName: query.from.first_name,
      lastName: query.from.last_name || null,
      isCallback: true,
      callbackQueryId: query.id,
      callbackData: query.data,
    };
  }

  // Handle regular message
  const message = update.message || update.edited_message;
  if (!message) {
    return null;
  }

  return {
    chatId: String(message.chat.id),
    messageId: message.message_id,
    text: message.text || null,
    userId: message.from?.id || 0,
    userName: message.from?.username || null,
    firstName: message.from?.first_name || null,
    lastName: message.from?.last_name || null,
    isCallback: false,
  };
}

/**
 * Check if update is from a private chat
 */
export function isPrivateChat(update: TelegramUpdate): boolean {
  const message = update.message || update.edited_message;
  if (message) {
    return message.chat.type === 'private';
  }
  return true; // Assume private for callback queries
}

// ============================================================================
// Bot Info
// ============================================================================

/**
 * Get bot information
 */
export async function getMe(): Promise<{
  id: number;
  firstName: string;
  username: string;
} | null> {
  try {
    const response = await telegramApi.get<TelegramApiResponse<TelegramUser>>('/getMe');
    if (response.data.ok && response.data.result) {
      return {
        id: response.data.result.id,
        firstName: response.data.result.first_name,
        username: response.data.result.username || '',
      };
    }
    return null;
  } catch (error) {
    handleTelegramError(error, 'getMe', '');
    return null;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Handle Telegram API errors
 */
function handleTelegramError(
  error: unknown,
  operation: string,
  chatId: string
): void {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<TelegramApiResponse<unknown>>;
    const apiError = axiosError.response?.data;

    logger.error('Telegram API error', {
      operation,
      chatId: chatId ? maskChatId(chatId) : undefined,
      status: axiosError.response?.status,
      errorCode: apiError?.error_code,
      description: apiError?.description,
    });

    // Check for specific error codes
    if (apiError?.error_code === 403) {
      logger.warn('Bot was blocked by user', { chatId: maskChatId(chatId) });
    } else if (apiError?.error_code === 429) {
      logger.warn('Telegram rate limit hit', { operation });
    }
  } else {
    logger.error('Telegram service error', {
      operation,
      chatId: chatId ? maskChatId(chatId) : undefined,
      error: (error as Error).message,
    });
  }
}

/**
 * Mask chat ID for logging (privacy)
 */
function maskChatId(chatId: string): string {
  if (chatId.length < 6) return chatId;
  return chatId.slice(0, 3) + '***' + chatId.slice(-3);
}

/**
 * Build full name from first and last name
 */
export function buildFullName(firstName: string | null, lastName: string | null): string | null {
  if (!firstName && !lastName) return null;
  if (!lastName) return firstName;
  if (!firstName) return lastName;
  return `${firstName} ${lastName}`;
}
