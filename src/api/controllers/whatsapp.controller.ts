/**
 * WhatsApp Webhook Controller
 *
 * Handles WhatsApp Cloud API webhooks for incoming messages
 * and the verification handshake.
 *
 * CRITICAL: Webhook must respond within 20 seconds or WhatsApp
 * will retry, potentially causing duplicate processing.
 */

import { Request, Response } from 'express';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';
import { normalizePhoneSafe } from '../../utils/phone-normalizer.js';
import * as LeadService from '../../services/lead.service.js';
import * as MessageService from '../../services/message.service.js';
import { isNewWebhookEvent } from '../../services/webhook-dedupe.service.js';
import * as ClaudeService from '../../services/claude.service.js';
import type { ToolExecutor } from '../../services/claude.service.js';
import * as WhatsAppService from '../../services/whatsapp.service.js';
import {
  onUserResponse,
  onLeadStateChange,
} from '../../services/follow-up-decision.service.js';
import type { Lead, UpdateLeadInput, LeadState } from '../../types/index.js';
import { query, queryOne } from '../../database/connection.js';
import { getWebSocketServer } from '../../realtime/ws-server.js';
import {
  emitLeadCreated,
  emitLeadUpdated,
  emitMessageNew,
  emitOverviewRefresh,
  getAccountIdByLeadId,
} from '../../realtime/emitter.js';
import { logTelemetry } from '../../services/telemetry.service.js';

// ============================================================================
// Types
// ============================================================================

/**
 * WhatsApp webhook message structure
 */
interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'interactive' | 'button' | 'image' | 'audio' | 'document' | 'location' | 'contacts' | 'sticker';
  text?: { body: string };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  button?: { payload: string; text: string };
}

/**
 * WhatsApp webhook payload structure
 */
interface WhatsAppWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: { name: string };
          wa_id: string;
        }>;
        messages?: WhatsAppMessage[];
        statuses?: Array<{
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          recipient_id: string;
        }>;
      };
      field: string;
    }>;
  }>;
}

// ============================================================================
// Webhook Verification
// ============================================================================

/**
 * Verify WhatsApp webhook (GET request)
 *
 * WhatsApp sends a GET request with verification parameters.
 * We must respond with the challenge to confirm ownership.
 */
export function verifyWebhook(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  logger.info('WhatsApp webhook verification request', {
    mode,
    hasToken: !!token,
    hasChallenge: !!challenge,
  });

  if (mode === 'subscribe' && token === config.whatsapp.webhookVerifyToken) {
    logger.info('WhatsApp webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    logger.warn('WhatsApp webhook verification failed', {
      mode,
      tokenMatch: token === config.whatsapp.webhookVerifyToken,
    });
    res.status(403).send('Forbidden');
  }
}

// ============================================================================
// Incoming Message Handler
// ============================================================================

/**
 * Handle incoming WhatsApp messages (POST request)
 *
 * CRITICAL: Must respond with 200 OK quickly to prevent retries.
 * Actual processing happens after acknowledgment.
 */
export async function handleIncomingMessage(
  req: Request,
  res: Response
): Promise<void> {
  // Acknowledge receipt immediately
  // WhatsApp requires 200 OK within 20 seconds
  res.status(200).json({ status: 'received' });

  try {
    const payload = req.body as WhatsAppWebhookPayload;

    // Validate payload structure
    if (!payload.entry?.[0]?.changes?.[0]?.value) {
      logger.debug('Invalid webhook payload structure');
      return;
    }

    const value = payload.entry[0].changes[0].value;

    // Check if this is a message (not a status update)
    if (!value.messages || value.messages.length === 0) {
      // This might be a status update (delivered, read, etc.)
      if (value.statuses) {
        await handleStatusUpdate(value.statuses);
      }
      return;
    }

    // Process each message
    for (const message of value.messages) {
      await processMessage(message, value.contacts?.[0]);
    }
  } catch (error) {
    // Log error but don't throw - we already sent 200 OK
    logger.error('Error processing WhatsApp webhook', {
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
async function processMessage(
  message: WhatsAppMessage,
  contact?: { profile: { name: string }; wa_id: string }
): Promise<void> {
  const startTime = Date.now();

  try {
    // Extract message content
    const messageText = extractMessageText(message);
    if (!messageText) {
      logger.debug('No text content in message', { type: message.type });
      return;
    }

    // Normalize phone number
    const phone = normalizePhoneSafe(message.from);
    if (!phone) {
      logger.warn('Invalid phone number', { from: message.from });
      return;
    }

    const whatsappMessageId = message.id;

    logger.info('Processing incoming message', {
      phone: maskPhone(phone),
      messageId: whatsappMessageId,
      type: message.type,
      textLength: messageText.length,
    });

    // Dedupe check — atomic INSERT ON CONFLICT, skip if already processed
    const isNew = await isNewWebhookEvent('whatsapp', whatsappMessageId);
    if (!isNew) {
      logger.info('Duplicate WhatsApp message skipped', { messageId: whatsappMessageId });
      return;
    }

    // Mark message as read in WhatsApp
    await WhatsAppService.markAsRead(whatsappMessageId);

    // Get or create lead
    const contactName = contact?.profile?.name;
    const { lead, created } = await LeadService.findOrCreateLead(phone, {
      name: contactName,
    });

    if (created) {
      logger.info('New lead created from WhatsApp', {
        leadId: lead.id,
        name: contactName,
      });
    }

    // Activation: mark real_lead status (monotonic, never downgrade)
    try {
      if (!lead.is_demo) {
        const tenantAccountId = await getAccountIdByLeadId(lead.id);
        if (tenantAccountId) {
          await query(
            `UPDATE settings SET profile = profile || '{"activation_status":"real_lead"}'::jsonb
             WHERE account_id = $1 AND profile->>'activation_status' != 'real_lead'`,
            [tenantAccountId],
          );
        }
      }
    } catch (activationErr) {
      logger.error('[ACTIVATION] Status update failed in WhatsApp handler', {
        error: (activationErr as Error).message,
      });
    }

    // Cancel any pending follow-ups - user is responding!
    await onUserResponse(lead.id);

    // Check for opt-out keywords
    if (isOptOutMessage(messageText)) {
      await handleOptOut(lead, messageText);
      return;
    }

    // Check if lead is opted out
    if (lead.opted_out) {
      logger.info('Lead is opted out, not processing', { leadId: lead.id });
      return;
    }

    // Look up active conversation for linking messages
    const conv = await queryOne<{ id: string }>(
      `SELECT id FROM conversations WHERE lead_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [lead.id],
    );
    const conversationId = conv?.id;

    // Save user message
    const userMessage = await MessageService.createUserMessage(lead.id, messageText, whatsappMessageId, conversationId);

    // Get conversation history for Claude
    const conversationHistory = await MessageService.getConversationForClaude(lead.id, 20);

    // Track lead state changes and interactive messages
    let updatedLead = lead;
    let interactiveMessage: WhatsAppService.WhatsAppInteractive | null = null;

    // Create tool executor function
    const toolExecutor: ToolExecutor = async (toolCall) => {
      if (toolCall.name === 'update_lead_state') {
        updatedLead = await processUpdateLeadState(lead.id, toolCall.input, messageText);
        return { result: JSON.stringify({ success: true, leadId: lead.id }) };
      } else if (toolCall.name === 'send_interactive_message') {
        interactiveMessage = processInteractiveMessage(toolCall.input);
        return { result: JSON.stringify({ success: true, messageQueued: !!interactiveMessage }) };
      }
      return { result: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }), isError: true };
    };

    // ── Empty input guard — skip AI call for empty/whitespace messages ──
    if (!messageText.trim()) {
      const fallbackResponse = 'היי! 😊 במה אפשר לעזור?';
      const botMessage = await MessageService.createBotMessage(
        lead.id, fallbackResponse, 0, 'fallback', 0, [], conversationId,
      );
      await WhatsAppService.sendTextMessage(phone, fallbackResponse);
      logger.info('[AI-GUARD] Empty input guard triggered', { leadId: lead.id });
      // Emit WS events
      try {
        const wss = getWebSocketServer();
        if (wss && conv) {
          const tenantId = await getAccountIdByLeadId(lead.id);
          if (tenantId) {
            emitMessageNew(wss, conv.id, userMessage.id, tenantId);
            emitMessageNew(wss, conv.id, botMessage.id, tenantId);
            emitOverviewRefresh(wss, tenantId);
          }
        }
      } catch { /* ignore emit errors */ }
      return;
    }

    // Call Claude API with agentic loop (automatic tool execution)
    const agentResult = await ClaudeService.sendMessageWithToolLoop(
      lead,
      conversationHistory,
      toolExecutor
    );

    // Save bot message
    const botMessage = await MessageService.createBotMessage(
      lead.id,
      agentResult.content,
      agentResult.totalUsage.totalTokens,
      agentResult.model,
      agentResult.responseTimeMs,
      agentResult.executedToolCalls.map(tc => tc.name),
      conversationId,
    );

    // Send response via WhatsApp
    await WhatsAppService.sendTextMessage(phone, agentResult.content);

    // Send interactive message if requested
    if (interactiveMessage) {
      await WhatsAppService.sendInteractiveMessage(phone, interactiveMessage);
    }

    const duration = Date.now() - startTime;
    logger.info('Message processed successfully', {
      leadId: lead.id,
      duration,
      tokens: agentResult.totalUsage.totalTokens,
      toolCalls: agentResult.executedToolCalls.length,
      apiCalls: agentResult.apiCallCount,
      statusChange: updatedLead.status !== lead.status ? `${lead.status} -> ${updatedLead.status}` : null,
    });

    // Realtime side-effects — fire and forget, after all mutations complete
    try {
      const wss = getWebSocketServer();
      if (wss) {
        const tenantId = await getAccountIdByLeadId(lead.id);
        if (tenantId) {
          if (created) {
            emitLeadCreated(wss, lead.id, tenantId);
          }

          if (conv) {
            emitMessageNew(wss, conv.id, userMessage.id, tenantId);
            emitMessageNew(wss, conv.id, botMessage.id, tenantId);
          }

          // Emit lead:updated if AI tool changed lead state
          if (updatedLead.status !== lead.status || updatedLead.lead_state !== lead.lead_state) {
            emitLeadUpdated(wss, lead.id, tenantId);
          }

          emitOverviewRefresh(wss, tenantId);
        } else {
          logger.warn('Could not resolve accountId for lead — skipping realtime', { leadId: lead.id });
        }
      }
    } catch (emitError) {
      logger.warn('Realtime emit failed', { error: emitError, leadId: lead.id });
    }

    // Telemetry — fire and forget, never await in main path
    void logTelemetry({
      ...agentResult.telemetry,
      lead_id: lead.id,
      conversation_id: conv?.id ?? null,
      message_id: botMessage.id,
      prompt_version_id: null,
    }).catch((err) => {
      logger.warn('Telemetry write failed', { error: err, leadId: lead.id });
    });

  } catch (error) {
    logger.error('Error processing message', {
      messageId: message.id,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    // Try to send an error message to the user
    try {
      const phone = normalizePhoneSafe(message.from);
      if (phone) {
        await WhatsAppService.sendTextMessage(
          phone,
          'סליחה, נתקלתי בבעיה טכנית. אנא נסה שוב בעוד כמה דקות. 🙏'
        );
      }
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
  input: Record<string, unknown>,
  lastUserMessage: string
): Promise<Lead> {
  logger.info('update_lead_state called', { leadId, input });

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

  // Handle lead_state for follow-up automation
  let newLeadState: LeadState | undefined;
  if (input.lead_state && typeof input.lead_state === 'string') {
    newLeadState = input.lead_state as LeadState;
    updateData.lead_state = newLeadState;
    logger.info('lead_state explicitly set', { leadId, newLeadState });
  }

  // Auto-map status → lead_state ONLY if lead_state wasn't explicitly set
  if (!updateData.lead_state) {
    if (input.status === 'considering' || input.status === 'hesitant') {
      newLeadState = 'thinking';
      updateData.lead_state = 'thinking';
      logger.info('lead_state auto-mapped from status', { leadId, status: input.status, newLeadState });
    }
  }

  // Safety net: Detect "thinking" phrases in user message
  // If user said thinking phrase but lead_state not set -> force it
  if (!updateData.lead_state && lastUserMessage) {
    const thinkingPhrases = ['אחשוב', 'אעדכן', 'צריך זמן', 'צריך לחשוב', 'אחזור אליך'];
    const userSaidThinking = thinkingPhrases.some(phrase =>
      lastUserMessage.includes(phrase)
    );

    if (userSaidThinking) {
      logger.warn('Safety net: User said thinking phrase but Claude did not set lead_state - forcing it', {
        leadId,
        userMessage: lastUserMessage.substring(0, 100),
        toolInput: input,
      });
      newLeadState = 'thinking';
      updateData.lead_state = 'thinking';
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

  // Trigger follow-up automation if lead_state changed
  if (newLeadState) {
    logger.info('Triggering follow-up automation', { leadId, newLeadState });
    try {
      const result = await onLeadStateChange(leadId, newLeadState);
      logger.info('Follow-up automation result', { leadId, newLeadState, result });
    } catch (error) {
      // Don't fail the update if follow-up scheduling fails
      logger.error('Failed to trigger follow-up automation', {
        leadId,
        newLeadState,
        error: (error as Error).message,
      });
    }
  } else {
    logger.debug('No lead_state change, skipping follow-up automation', { leadId, updateData });
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

/**
 * Process send_interactive_message tool call
 */
function processInteractiveMessage(
  input: Record<string, unknown>
): WhatsAppService.WhatsAppInteractive | null {
  try {
    const type = input.type as 'button' | 'list';
    const body = input.body as string;
    const buttons = input.buttons as Array<{ id: string; title: string }> | undefined;
    const header = input.header as string | undefined;
    const footer = input.footer as string | undefined;

    if (!type || !body) {
      logger.warn('Invalid interactive message input', { input });
      return null;
    }

    if (type === 'button' && buttons) {
      return WhatsAppService.buildButtonMessage(body, buttons, { header, footer });
    }

    // Add list support if needed
    return null;
  } catch (error) {
    logger.error('Error building interactive message', { error, input });
    return null;
  }
}

// ============================================================================
// Status Updates
// ============================================================================

/**
 * Handle message status updates (delivered, read, etc.)
 */
async function handleStatusUpdate(
  statuses: Array<{
    id: string;
    status: string;
    timestamp: string;
    recipient_id: string;
  }>
): Promise<void> {
  for (const status of statuses) {
    logger.debug('Message status update', {
      messageId: status.id,
      status: status.status,
      recipient: maskPhone(status.recipient_id),
    });
  }
}

// ============================================================================
// Opt-Out Handling
// ============================================================================

/**
 * Check if message is an opt-out request
 */
function isOptOutMessage(text: string): boolean {
  const optOutKeywords = [
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
async function handleOptOut(lead: Lead, _messageText: string): Promise<void> {
  await LeadService.optOutLead(lead.id);

  // Send confirmation message
  try {
    await WhatsAppService.sendTextMessage(
      lead.phone,
      'הוסרת מרשימת התפוצה שלנו בהצלחה. ✅\n\nאם תרצה לחזור אלינו בעתיד, פשוט שלח הודעה.'
    );
  } catch {
    // Ignore send errors for opt-out confirmation
  }

  logger.info('Lead opted out', { leadId: lead.id });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract text content from various message types
 */
function extractMessageText(message: WhatsAppMessage): string | null {
  switch (message.type) {
    case 'text':
      return message.text?.body || null;

    case 'interactive':
      if (message.interactive?.type === 'button_reply') {
        return message.interactive.button_reply?.title || null;
      }
      if (message.interactive?.type === 'list_reply') {
        return message.interactive.list_reply?.title || null;
      }
      return null;

    case 'button':
      return message.button?.text || null;

    case 'image':
    case 'audio':
    case 'document':
    case 'location':
    case 'contacts':
    case 'sticker':
      // For media messages, we could extract captions or handle differently
      logger.debug('Unsupported message type', { type: message.type });
      return null;

    default:
      logger.debug('Unknown message type', { type: message.type });
      return null;
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
// Exports
// ============================================================================

export { WhatsAppWebhookPayload, WhatsAppMessage };
