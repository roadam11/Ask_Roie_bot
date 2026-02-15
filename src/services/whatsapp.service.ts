/**
 * WhatsApp Service
 *
 * Handles all WhatsApp Cloud API interactions including
 * sending messages, interactive elements, and status updates.
 *
 * @example
 * import * as WhatsAppService from './services/whatsapp.service.js';
 *
 * await WhatsAppService.sendTextMessage('+972501234567', 'Hello!');
 * await WhatsAppService.sendInteractiveMessage('+972501234567', { type: 'button', ... });
 */

import axios, { AxiosError } from 'axios';
import config from '../config/index.js';
import logger, { logWhatsApp } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * WhatsApp interactive button
 */
interface WhatsAppButton {
  type: 'reply';
  reply: {
    id: string;
    title: string; // Max 20 chars
  };
}

/**
 * WhatsApp interactive list row
 */
interface WhatsAppListRow {
  id: string;
  title: string; // Max 24 chars
  description?: string; // Max 72 chars
}

/**
 * WhatsApp interactive list section
 */
interface WhatsAppListSection {
  title?: string;
  rows: WhatsAppListRow[];
}

/**
 * WhatsApp interactive message payload
 */
export interface WhatsAppInteractive {
  type: 'button' | 'list';
  header?: {
    type: 'text';
    text: string;
  };
  body: {
    text: string;
  };
  footer?: {
    text: string;
  };
  action: {
    buttons?: WhatsAppButton[];
    button?: string; // For list: "Select an option"
    sections?: WhatsAppListSection[];
  };
}

/**
 * WhatsApp API response
 */
interface WhatsAppApiResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

/**
 * WhatsApp API error response
 */
interface WhatsAppApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id: string;
  };
}

// ============================================================================
// API Client Setup
// ============================================================================

/**
 * WhatsApp API client with base configuration
 */
const whatsappApi = axios.create({
  baseURL: `${config.whatsapp.apiBaseUrl}/${config.whatsapp.phoneNumberId}`,
  headers: {
    'Authorization': `Bearer ${config.whatsapp.accessToken}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

// ============================================================================
// Message Sending
// ============================================================================

/**
 * Send a text message via WhatsApp
 *
 * @param phone - Recipient phone number in E.164 format
 * @param text - Message text (max 4096 chars)
 * @returns WhatsApp message ID
 */
export async function sendTextMessage(
  phone: string,
  text: string
): Promise<string> {
  const startTime = Date.now();

  try {
    // Truncate text if too long
    const truncatedText = text.length > 4096 ? text.substring(0, 4093) + '...' : text;

    const response = await whatsappApi.post<WhatsAppApiResponse>('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone.replace('+', ''), // WhatsApp expects without +
      type: 'text',
      text: {
        preview_url: true,
        body: truncatedText,
      },
    });

    const duration = Date.now() - startTime;
    const messageId = response.data.messages[0]?.id;

    logWhatsApp('message_sent', phone, {
      messageId,
      textLength: truncatedText.length,
      duration,
    });

    logger.info('WhatsApp text message sent', {
      phone: maskPhone(phone),
      messageId,
      textLength: truncatedText.length,
    });

    return messageId;
  } catch (error) {
    handleWhatsAppError(error, 'sendTextMessage', phone);
    throw error;
  }
}

/**
 * Send an interactive message via WhatsApp (buttons or list)
 *
 * @param phone - Recipient phone number in E.164 format
 * @param interactive - Interactive message payload
 * @returns WhatsApp message ID
 */
export async function sendInteractiveMessage(
  phone: string,
  interactive: WhatsAppInteractive
): Promise<string> {
  const startTime = Date.now();

  try {
    // Validate interactive message
    validateInteractiveMessage(interactive);

    const response = await whatsappApi.post<WhatsAppApiResponse>('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone.replace('+', ''),
      type: 'interactive',
      interactive,
    });

    const duration = Date.now() - startTime;
    const messageId = response.data.messages[0]?.id;

    logWhatsApp('interactive_sent', phone, {
      messageId,
      interactiveType: interactive.type,
      buttonCount: interactive.action.buttons?.length,
      duration,
    });

    logger.info('WhatsApp interactive message sent', {
      phone: maskPhone(phone),
      messageId,
      type: interactive.type,
    });

    return messageId;
  } catch (error) {
    handleWhatsAppError(error, 'sendInteractiveMessage', phone);
    throw error;
  }
}

/**
 * Send a template message via WhatsApp
 * Used when outside the 24-hour window
 *
 * @param phone - Recipient phone number
 * @param templateName - Name of the approved template
 * @param languageCode - Language code (e.g., 'he' for Hebrew)
 * @param components - Template components (header, body variables)
 */
export async function sendTemplateMessage(
  phone: string,
  templateName: string,
  languageCode: string = 'he',
  components?: Array<{
    type: 'header' | 'body';
    parameters: Array<{ type: 'text'; text: string }>;
  }>
): Promise<string> {
  const startTime = Date.now();

  try {
    const response = await whatsappApi.post<WhatsAppApiResponse>('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone.replace('+', ''),
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
        components,
      },
    });

    const duration = Date.now() - startTime;
    const messageId = response.data.messages[0]?.id;

    logWhatsApp('template_sent', phone, {
      messageId,
      templateName,
      languageCode,
      duration,
    });

    logger.info('WhatsApp template message sent', {
      phone: maskPhone(phone),
      messageId,
      templateName,
    });

    return messageId;
  } catch (error) {
    handleWhatsAppError(error, 'sendTemplateMessage', phone);
    throw error;
  }
}

// ============================================================================
// Message Status
// ============================================================================

/**
 * Mark a message as read in WhatsApp
 *
 * @param messageId - WhatsApp message ID to mark as read
 */
export async function markAsRead(messageId: string): Promise<void> {
  try {
    await whatsappApi.post('/messages', {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });

    logger.debug('Message marked as read', { messageId });
  } catch (error) {
    // Don't throw - marking as read is not critical
    logger.warn('Failed to mark message as read', {
      messageId,
      error: (error as Error).message,
    });
  }
}

// ============================================================================
// Media Messages
// ============================================================================

/**
 * Send an image message
 *
 * @param phone - Recipient phone number
 * @param imageUrl - URL of the image to send
 * @param caption - Optional caption
 */
export async function sendImageMessage(
  phone: string,
  imageUrl: string,
  caption?: string
): Promise<string> {
  try {
    const response = await whatsappApi.post<WhatsAppApiResponse>('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone.replace('+', ''),
      type: 'image',
      image: {
        link: imageUrl,
        caption,
      },
    });

    const messageId = response.data.messages[0]?.id;

    logWhatsApp('image_sent', phone, {
      messageId,
      hasCaption: !!caption,
    });

    return messageId;
  } catch (error) {
    handleWhatsAppError(error, 'sendImageMessage', phone);
    throw error;
  }
}

/**
 * Send a document message
 *
 * @param phone - Recipient phone number
 * @param documentUrl - URL of the document to send
 * @param filename - Filename to display
 * @param caption - Optional caption
 */
export async function sendDocumentMessage(
  phone: string,
  documentUrl: string,
  filename: string,
  caption?: string
): Promise<string> {
  try {
    const response = await whatsappApi.post<WhatsAppApiResponse>('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone.replace('+', ''),
      type: 'document',
      document: {
        link: documentUrl,
        filename,
        caption,
      },
    });

    const messageId = response.data.messages[0]?.id;

    logWhatsApp('document_sent', phone, {
      messageId,
      filename,
    });

    return messageId;
  } catch (error) {
    handleWhatsAppError(error, 'sendDocumentMessage', phone);
    throw error;
  }
}

// ============================================================================
// Reaction Messages
// ============================================================================

/**
 * Send a reaction to a message
 *
 * @param phone - Recipient phone number
 * @param messageId - ID of the message to react to
 * @param emoji - Emoji to react with
 */
export async function sendReaction(
  phone: string,
  messageId: string,
  emoji: string
): Promise<void> {
  try {
    await whatsappApi.post('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone.replace('+', ''),
      type: 'reaction',
      reaction: {
        message_id: messageId,
        emoji,
      },
    });

    logger.debug('Reaction sent', { messageId, emoji });
  } catch (error) {
    // Don't throw - reactions are not critical
    logger.warn('Failed to send reaction', {
      messageId,
      emoji,
      error: (error as Error).message,
    });
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate interactive message payload
 */
function validateInteractiveMessage(interactive: WhatsAppInteractive): void {
  if (interactive.type === 'button') {
    const buttons = interactive.action.buttons;
    if (!buttons || buttons.length === 0) {
      throw new Error('Button interactive message requires at least one button');
    }
    if (buttons.length > 3) {
      throw new Error('Button interactive message allows maximum 3 buttons');
    }
    for (const button of buttons) {
      if (button.reply.title.length > 20) {
        throw new Error(`Button title exceeds 20 chars: "${button.reply.title}"`);
      }
    }
  }

  if (interactive.type === 'list') {
    const sections = interactive.action.sections;
    if (!sections || sections.length === 0) {
      throw new Error('List interactive message requires at least one section');
    }
    if (sections.length > 10) {
      throw new Error('List interactive message allows maximum 10 sections');
    }
    for (const section of sections) {
      if (section.rows.length > 10) {
        throw new Error('List section allows maximum 10 rows');
      }
      for (const row of section.rows) {
        if (row.title.length > 24) {
          throw new Error(`Row title exceeds 24 chars: "${row.title}"`);
        }
        if (row.description && row.description.length > 72) {
          throw new Error(`Row description exceeds 72 chars`);
        }
      }
    }
  }

  if (interactive.body.text.length > 1024) {
    throw new Error('Interactive body text exceeds 1024 chars');
  }
}

/**
 * Handle WhatsApp API errors
 */
function handleWhatsAppError(
  error: unknown,
  operation: string,
  phone: string
): void {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<WhatsAppApiError>;
    const waError = axiosError.response?.data?.error;

    logger.error('WhatsApp API error', {
      operation,
      phone: maskPhone(phone),
      status: axiosError.response?.status,
      code: waError?.code,
      message: waError?.message,
      type: waError?.type,
      fbtrace_id: waError?.fbtrace_id,
    });

    // Check for specific error codes
    if (waError?.code === 131047) {
      logger.warn('WhatsApp 24-hour window expired', { phone: maskPhone(phone) });
    }
  } else {
    logger.error('WhatsApp service error', {
      operation,
      phone: maskPhone(phone),
      error: (error as Error).message,
    });
  }
}

/**
 * Mask phone number for logging
 */
function maskPhone(phone: string): string {
  if (phone.length < 8) return phone;
  return phone.slice(0, 4) + '****' + phone.slice(-4);
}

// ============================================================================
// Interactive Message Builders
// ============================================================================

/**
 * Build a button interactive message
 */
export function buildButtonMessage(
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
  options?: { header?: string; footer?: string }
): WhatsAppInteractive {
  return {
    type: 'button',
    header: options?.header ? { type: 'text', text: options.header } : undefined,
    body: { text: bodyText },
    footer: options?.footer ? { text: options.footer } : undefined,
    action: {
      buttons: buttons.map((btn) => ({
        type: 'reply' as const,
        reply: {
          id: btn.id,
          title: btn.title.substring(0, 20), // Ensure max 20 chars
        },
      })),
    },
  };
}

/**
 * Build a list interactive message
 */
export function buildListMessage(
  bodyText: string,
  buttonText: string,
  sections: Array<{
    title?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>,
  options?: { header?: string; footer?: string }
): WhatsAppInteractive {
  return {
    type: 'list',
    header: options?.header ? { type: 'text', text: options.header } : undefined,
    body: { text: bodyText },
    footer: options?.footer ? { text: options.footer } : undefined,
    action: {
      button: buttonText.substring(0, 20),
      sections: sections.map((section) => ({
        title: section.title,
        rows: section.rows.map((row) => ({
          id: row.id,
          title: row.title.substring(0, 24),
          description: row.description?.substring(0, 72),
        })),
      })),
    },
  };
}

// ============================================================================
// Exports
// ============================================================================

export type { WhatsAppButton, WhatsAppListRow, WhatsAppListSection };
