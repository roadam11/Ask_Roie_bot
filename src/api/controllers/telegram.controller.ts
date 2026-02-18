/**
 * Telegram Webhook Controller
 *
 * Handles Telegram Bot API webhooks for incoming messages
 * and callback queries.
 *
 * Key differences from WhatsApp:
 * - No 24-hour window restrictions
 * - Uses chat_id instead of phone number
 * - No webhook verification needed (just set the URL)
 * - Simpler message format
 */

import { Request, Response } from 'express';
import logger from '../../utils/logger.js';
import * as LeadService from '../../services/lead.service.js';
import * as MessageService from '../../services/message.service.js';
import * as ClaudeService from '../../services/claude.service.js';
import * as TelegramService from '../../services/telegram.service.js';
import type { TelegramUpdate } from '../../services/telegram.service.js';
import type { Lead, UpdateLeadInput } from '../../types/index.js';

// ============================================================================
// Webhook Handler
// ============================================================================

/**
 * Handle incoming Telegram updates (POST request)
 *
 * Telegram expects a 200 OK response quickly.
 * Processing happens after acknowledgment.
 */
export async function handleUpdate(
  req: Request,
  res: Response
): Promise<void> {
  // Acknowledge receipt immediately
  res.status(200).json({ ok: true });

  try {
    const update = req.body as TelegramUpdate;

    // Parse the update
    const parsed = TelegramService.parseUpdate(update);
    if (!parsed) {
      logger.debug('No parseable content in Telegram update');
      return;
    }

    // Skip non-private chats (groups, channels)
    if (!TelegramService.isPrivateChat(update)) {
      logger.debug('Ignoring non-private chat message');
      return;
    }

    // Handle callback queries (button presses)
    if (parsed.isCallback && parsed.callbackQueryId) {
      await TelegramService.answerCallbackQuery(parsed.callbackQueryId);
    }

    // Process the message
    await processMessage(parsed);

  } catch (error) {
    // Log error but don't throw - we already sent 200 OK
    logger.error('Error processing Telegram update', {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
}

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Process a single incoming message
 */
async function processMessage(parsed: {
  chatId: string;
  messageId: number;
  text: string | null;
  userId: number;
  userName: string | null;
  firstName: string | null;
  lastName: string | null;
  isCallback: boolean;
  callbackData?: string;
}): Promise<void> {
  const startTime = Date.now();

  try {
    // Extract message content
    const messageText = parsed.text;
    if (!messageText) {
      logger.debug('No text content in Telegram message');
      return;
    }

    const chatId = parsed.chatId;
    const telegramMessageId = `tg_${parsed.messageId}`;

    logger.info('Processing incoming Telegram message', {
      chatId: maskChatId(chatId),
      messageId: telegramMessageId,
      textLength: messageText.length,
      isCallback: parsed.isCallback,
    });

    // Check idempotency - has this message been processed?
    const alreadyProcessed = await MessageService.isMessageProcessed(telegramMessageId);
    if (alreadyProcessed) {
      logger.info('Telegram message already processed, skipping', { messageId: telegramMessageId });
      return;
    }

    // Send typing indicator
    await TelegramService.sendTypingAction(chatId);

    // Build contact name
    const contactName = TelegramService.buildFullName(parsed.firstName, parsed.lastName);

    // Get or create lead using chat_id as identifier (prefixed with 'tg_')
    const telegramIdentifier = `tg_${chatId}`;
    const { lead, created } = await LeadService.findOrCreateLead(telegramIdentifier, {
      name: contactName || undefined,
      source: 'telegram',
    });

    if (created) {
      logger.info('New lead created from Telegram', {
        leadId: lead.id,
        name: contactName,
        chatId: maskChatId(chatId),
      });
    }

    // Check for opt-out keywords
    if (isOptOutMessage(messageText)) {
      await handleOptOut(lead, chatId);
      return;
    }

    // Check if lead is opted out
    if (lead.opted_out) {
      logger.info('Lead is opted out, not processing', { leadId: lead.id });
      return;
    }

    // Save user message
    await MessageService.createUserMessage(lead.id, messageText, telegramMessageId);

    // Get conversation history for Claude
    const conversationHistory = await MessageService.getConversationForClaude(lead.id, 20);

    // Send another typing indicator (Claude can take a few seconds)
    await TelegramService.sendTypingAction(chatId);

    // Call Claude API
    const claudeResponse = await ClaudeService.sendMessage(
      lead,
      conversationHistory
    );

    // Process tool calls (update lead state)
    let updatedLead = lead;

    for (const toolCall of claudeResponse.toolCalls) {
      if (toolCall.name === 'update_lead_state') {
        updatedLead = await processUpdateLeadState(lead.id, toolCall.input);
      }
      // Note: Interactive messages for Telegram would need different handling
    }

    // Save bot message
    await MessageService.createBotMessage(
      lead.id,
      claudeResponse.content,
      claudeResponse.usage.totalTokens,
      claudeResponse.model
    );

    // Send response via Telegram
    if (claudeResponse.content) {
      await TelegramService.sendMessage(chatId, claudeResponse.content);
    }

    const duration = Date.now() - startTime;
    logger.info('Telegram message processed successfully', {
      leadId: lead.id,
      chatId: maskChatId(chatId),
      duration,
      tokens: claudeResponse.usage.totalTokens,
      toolCalls: claudeResponse.toolCalls.length,
      statusChange: updatedLead.status !== lead.status ? `${lead.status} -> ${updatedLead.status}` : null,
    });

  } catch (error) {
    logger.error('Error processing Telegram message', {
      chatId: parsed.chatId,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    // Try to send an error message to the user
    try {
      await TelegramService.sendMessage(
        parsed.chatId,
        'סליחה, נתקלתי בבעיה טכנית. אנא נסה שוב בעוד כמה דקות.'
      );
    } catch {
      // Ignore error sending error message
    }
  }
}

// ============================================================================
// Tool Processing
// ============================================================================

/**
 * Process update_lead_state tool call
 */
async function processUpdateLeadState(
  leadId: string,
  input: Record<string, unknown>
): Promise<Lead> {
  // Validate input
  const validation = ClaudeService.validateUpdateLeadStateInput(input);

  if (!validation.valid) {
    logger.warn('Invalid update_lead_state input', { leadId, input, errors: validation.errors });
    const lead = await LeadService.findLeadById(leadId);
    if (!lead) throw new Error(`Lead not found: ${leadId}`);
    return lead;
  }

  // Build update payload, excluding 'booked' status
  const updateData: UpdateLeadInput = {};

  if (input.name && typeof input.name === 'string') {
    updateData.name = input.name;
  }
  if (input.subjects && Array.isArray(input.subjects)) {
    updateData.subjects = input.subjects as string[];
  }
  if (input.level && typeof input.level === 'string') {
    updateData.level = input.level as UpdateLeadInput['level'];
  }
  if (input.grade_details && typeof input.grade_details === 'string') {
    updateData.grade_details = input.grade_details;
  }
  if (input.format_preference && typeof input.format_preference === 'string') {
    updateData.format_preference = input.format_preference as UpdateLeadInput['format_preference'];
  }
  if (input.parent_or_student && typeof input.parent_or_student === 'string') {
    updateData.parent_or_student = input.parent_or_student as UpdateLeadInput['parent_or_student'];
  }
  if (input.has_exam !== undefined && typeof input.has_exam === 'boolean') {
    updateData.has_exam = input.has_exam;
  }
  if (input.urgency && typeof input.urgency === 'string') {
    updateData.urgency = input.urgency as UpdateLeadInput['urgency'];
  }
  if (input.objection_type && typeof input.objection_type === 'string') {
    updateData.objection_type = input.objection_type as UpdateLeadInput['objection_type'];
  }
  if (input.trial_offered !== undefined && typeof input.trial_offered === 'boolean') {
    updateData.trial_offered = input.trial_offered;
  }
  if (input.needs_human_followup !== undefined && typeof input.needs_human_followup === 'boolean') {
    updateData.needs_human_followup = input.needs_human_followup;
  }

  // Handle status (block 'booked')
  if (input.status && typeof input.status === 'string') {
    if (input.status === 'booked') {
      logger.warn('Blocked attempt to set status to booked', { leadId });
    } else {
      updateData.status = input.status as UpdateLeadInput['status'];
    }
  }

  // Update lead if there are changes
  if (Object.keys(updateData).length === 0) {
    const lead = await LeadService.findLeadById(leadId);
    if (!lead) throw new Error(`Lead not found: ${leadId}`);
    return lead;
  }

  const updatedLead = await LeadService.updateLead(leadId, updateData);

  if (!updatedLead) {
    throw new Error(`Failed to update lead: ${leadId}`);
  }

  // Try to auto-qualify if conditions are met
  if (updatedLead.status === 'new') {
    const qualified = await LeadService.tryAutoQualify(updatedLead);
    if (qualified) {
      logger.info('Lead auto-qualified', { leadId });
      return qualified;
    }
  }

  return updatedLead;
}

// ============================================================================
// Opt-Out Handling
// ============================================================================

/**
 * Check if message is an opt-out request
 */
function isOptOutMessage(text: string): boolean {
  const optOutKeywords = [
    '/stop',
    'stop',
    'unsubscribe',
    'הסר',
    'הסירו',
    'הסר אותי',
    'לא מעוניין',
    'לא רוצה',
    'עזוב אותי',
    'תפסיק',
    'תפסיקו',
  ];

  const lowerText = text.toLowerCase().trim();
  return optOutKeywords.some((keyword) => lowerText.includes(keyword.toLowerCase()));
}

/**
 * Handle opt-out request
 */
async function handleOptOut(lead: Lead, chatId: string): Promise<void> {
  await LeadService.optOutLead(lead.id);

  // Send confirmation message
  try {
    await TelegramService.sendMessage(
      chatId,
      'הוסרת מרשימת התפוצה שלנו בהצלחה.\n\nאם תרצה לחזור אלינו בעתיד, פשוט שלח הודעה.'
    );
  } catch {
    // Ignore send errors for opt-out confirmation
  }

  logger.info('Lead opted out via Telegram', { leadId: lead.id, chatId: maskChatId(chatId) });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Mask chat ID for logging (privacy)
 */
function maskChatId(chatId: string): string {
  if (chatId.length < 6) return chatId;
  return chatId.slice(0, 3) + '***' + chatId.slice(-3);
}

// ============================================================================
// Exports
// ============================================================================

export { TelegramUpdate };
