/**
 * Message Service - Business Logic Layer
 *
 * Wraps the Message model with conversation management,
 * timestamp updates, and Claude API formatting.
 *
 * @example
 * import * as MessageService from './services/message.service.js';
 *
 * await MessageService.createUserMessage(leadId, 'Hello', 'wamid.xyz');
 * await MessageService.createBotMessage(leadId, 'Hi! How can I help?', 150, 'claude-sonnet');
 * const history = await MessageService.getConversationForClaude(leadId, 10);
 */

import * as MessageModel from '../models/message.model.js';
import * as LeadModel from '../models/lead.model.js';
import logger from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Message format for Claude API
 */
export type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

/**
 * Raw message from database
 */
type Message = Awaited<ReturnType<typeof MessageModel.findById>> & {};

// ============================================================================
// Message Creation with Side Effects
// ============================================================================

/**
 * Create a user message and update lead timestamp
 *
 * @param leadId - Lead UUID
 * @param content - Message content
 * @param whatsappMessageId - Optional WhatsApp message ID for idempotency
 * @returns The created message
 */
export async function createUserMessage(
  leadId: string,
  content: string,
  whatsappMessageId?: string,
  conversationId?: string
): Promise<NonNullable<Message>> {
  // Create the message (with idempotency check if whatsappMessageId provided)
  const message = await MessageModel.create(leadId, 'user', content, {
    whatsappMessageId,
    conversationId,
  });

  // Update lead's last_user_message_at timestamp
  await LeadModel.updateUserMessageTimestamp(leadId);

  logger.info('User message created', {
    messageId: message.id,
    leadId,
    contentLength: content.length,
    hasWhatsAppId: !!whatsappMessageId,
  });

  return message;
}

/**
 * Create a bot message and update lead timestamp
 *
 * @param leadId - Lead UUID
 * @param content - Message content
 * @param tokensUsed - Optional token count from Claude
 * @param modelUsed - Optional model identifier
 * @returns The created message
 */
export async function createBotMessage(
  leadId: string,
  content: string,
  tokensUsed?: number,
  modelUsed?: string,
  responseTimeMs?: number,
  toolCallsUsed?: string[],
  conversationId?: string,
): Promise<NonNullable<Message>> {
  // Create the message
  const message = await MessageModel.create(leadId, 'bot', content, {
    tokensUsed,
    modelUsed,
    responseTimeMs,
    toolCallsUsed,
    conversationId,
  });

  // Update lead's last_bot_message_at timestamp
  await LeadModel.updateBotMessageTimestamp(leadId);

  logger.info('Bot message created', {
    messageId: message.id,
    leadId,
    contentLength: content.length,
    tokensUsed,
    modelUsed,
  });

  return message;
}

/**
 * Create a system message (for logging/debugging, not sent to user)
 *
 * @param leadId - Lead UUID
 * @param content - System message content
 * @returns The created message
 */
export async function createSystemMessage(
  leadId: string,
  content: string
): Promise<NonNullable<Message>> {
  const message = await MessageModel.create(leadId, 'system', content);

  logger.debug('System message created', {
    messageId: message.id,
    leadId,
  });

  return message;
}

// ============================================================================
// Conversation Retrieval
// ============================================================================

/**
 * Get conversation history formatted for Claude API
 *
 * @param leadId - Lead UUID
 * @param maxMessages - Maximum number of messages (default: 20)
 * @returns Array of messages in Claude format
 */
export async function getConversationForClaude(
  leadId: string,
  maxMessages = 20
): Promise<ConversationMessage[]> {
  const messages = await MessageModel.getConversationHistory(leadId, maxMessages);

  // Convert to Claude format
  // 'user' stays 'user', 'bot' and 'system' become 'assistant'
  const claudeMessages: ConversationMessage[] = messages
    .filter((msg) => msg !== null)
    .map((msg) => ({
      role: msg!.role === 'user' ? 'user' : 'assistant',
      content: msg!.content,
    }));

  // Ensure conversation starts with user message (Claude requirement)
  // If first message is assistant, remove it
  while (claudeMessages.length > 0 && claudeMessages[0].role === 'assistant') {
    claudeMessages.shift();
  }

  // Merge consecutive messages from same role
  // Claude API requires alternating user/assistant messages
  const mergedMessages: ConversationMessage[] = [];
  for (const msg of claudeMessages) {
    const lastMsg = mergedMessages[mergedMessages.length - 1];
    if (lastMsg && lastMsg.role === msg.role) {
      // Merge with previous message of same role
      lastMsg.content += '\n\n' + msg.content;
    } else {
      mergedMessages.push({ ...msg });
    }
  }

  logger.debug('Retrieved conversation for Claude', {
    leadId,
    originalCount: messages.length,
    formattedCount: mergedMessages.length,
  });

  return mergedMessages;
}

/**
 * Build conversation context as formatted text
 * Used for system prompt replacement
 *
 * @param leadId - Lead UUID
 * @param maxMessages - Maximum number of messages
 * @returns Formatted conversation text
 */
export async function buildConversationContext(
  leadId: string,
  maxMessages = 15
): Promise<string> {
  const messages = await MessageModel.getConversationHistory(leadId, maxMessages);

  if (!messages || messages.length === 0) {
    return 'No previous messages. This is the start of the conversation.';
  }

  const formattedMessages = messages
    .filter((msg) => msg !== null)
    .map((msg) => {
      const role = msg!.role === 'user' ? 'Lead' : msg!.role === 'bot' ? 'You (Bot)' : 'System';
      const timestamp = new Date(msg!.created_at).toLocaleTimeString('he-IL', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return `[${timestamp}] ${role}: ${msg!.content}`;
    });

  return formattedMessages.join('\n\n');
}

/**
 * Get a summary of the conversation
 *
 * @param leadId - Lead UUID
 * @returns Conversation summary
 */
export async function getConversationSummary(leadId: string): Promise<{
  totalMessages: number;
  userMessages: number;
  botMessages: number;
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
  totalTokensUsed: number;
}> {
  const counts = await MessageModel.countMessagesByRole(leadId);
  const totalTokens = await MessageModel.getTotalTokensUsed(leadId);
  const lastMessage = await MessageModel.getLastMessage(leadId);

  // Get first message
  const messages = await MessageModel.getConversationHistory(leadId, 1);
  const firstMessage = messages.length > 0 ? messages[0] : null;

  return {
    totalMessages: counts.user + counts.bot + counts.system,
    userMessages: counts.user,
    botMessages: counts.bot,
    firstMessageAt: firstMessage ? new Date(firstMessage.created_at) : null,
    lastMessageAt: lastMessage ? new Date(lastMessage.created_at) : null,
    totalTokensUsed: totalTokens,
  };
}

// ============================================================================
// Message Lookup
// ============================================================================

/**
 * Check if a WhatsApp message has already been processed
 *
 * @param whatsappMessageId - WhatsApp message ID
 * @returns true if already processed
 */
export async function isMessageProcessed(whatsappMessageId: string): Promise<boolean> {
  return MessageModel.isMessageProcessed(whatsappMessageId);
}

/**
 * Get the last message from user
 *
 * @param leadId - Lead UUID
 * @returns Last user message or null
 */
export async function getLastUserMessage(leadId: string): Promise<Message | null> {
  return MessageModel.getLastUserMessage(leadId);
}

/**
 * Get the last message from bot
 *
 * @param leadId - Lead UUID
 * @returns Last bot message or null
 */
export async function getLastBotMessage(leadId: string): Promise<Message | null> {
  return MessageModel.getLastBotMessage(leadId);
}

/**
 * Get the last message (any role)
 *
 * @param leadId - Lead UUID
 * @returns Last message or null
 */
export async function getLastMessage(leadId: string): Promise<Message | null> {
  return MessageModel.getLastMessage(leadId);
}

// ============================================================================
// Conversation Analysis
// ============================================================================

/**
 * Extract mentioned subjects from conversation
 *
 * @param leadId - Lead UUID
 * @returns Array of detected subjects
 */
export async function extractMentionedSubjects(leadId: string): Promise<string[]> {
  const messages = await MessageModel.getConversationHistory(leadId, 50);
  const allContent = messages
    .filter((m) => m?.role === 'user')
    .map((m) => m!.content.toLowerCase())
    .join(' ');

  const subjects: string[] = [];

  // Hebrew and English subject detection
  const subjectPatterns: Record<string, RegExp> = {
    mathematics: /מתמטיקה|מתמט|חשבון|math|mathematics/i,
    physics: /פיזיקה|פיסיקה|physics/i,
    computer_science: /מדעי המחשב|תכנות|מחשבים|programming|computer|cs/i,
    chemistry: /כימיה|chemistry/i,
    biology: /ביולוגיה|biology/i,
    english: /אנגלית|english/i,
  };

  for (const [subject, pattern] of Object.entries(subjectPatterns)) {
    if (pattern.test(allContent)) {
      subjects.push(subject);
    }
  }

  return subjects;
}

/**
 * Detect urgency indicators in conversation
 *
 * @param leadId - Lead UUID
 * @returns Urgency level and indicators
 */
export async function detectUrgency(leadId: string): Promise<{
  level: 'high' | 'medium' | 'low';
  indicators: string[];
}> {
  const messages = await MessageModel.getConversationHistory(leadId, 20);
  const userContent = messages
    .filter((m) => m?.role === 'user')
    .map((m) => m!.content.toLowerCase())
    .join(' ');

  const indicators: string[] = [];

  // High urgency patterns
  const highPatterns = [
    /מחר|tomorrow/i,
    /דחוף|urgent/i,
    /מבחן בקרוב|exam soon/i,
    /עוד יום|שבוע הבא|next week/i,
    /בגרות/i,
  ];

  // Medium urgency patterns
  const mediumPatterns = [
    /מבחן|exam|test/i,
    /צריך עזרה|need help/i,
    /לא מבין|don't understand/i,
  ];

  for (const pattern of highPatterns) {
    if (pattern.test(userContent)) {
      indicators.push(pattern.source);
    }
  }

  if (indicators.length > 0) {
    return { level: 'high', indicators };
  }

  for (const pattern of mediumPatterns) {
    if (pattern.test(userContent)) {
      indicators.push(pattern.source);
    }
  }

  if (indicators.length > 0) {
    return { level: 'medium', indicators };
  }

  return { level: 'low', indicators: [] };
}

/**
 * Detect objection type from conversation
 *
 * @param leadId - Lead UUID
 * @returns Detected objection type
 */
export async function detectObjection(
  leadId: string
): Promise<'price' | 'time' | 'format' | 'trust' | 'other' | 'none'> {
  const messages = await MessageModel.getConversationHistory(leadId, 10);
  const userContent = messages
    .filter((m) => m?.role === 'user')
    .map((m) => m!.content.toLowerCase())
    .join(' ');

  // Price objection
  if (/יקר|כסף|מחיר|תקציב|expensive|price|cost|budget/i.test(userContent)) {
    return 'price';
  }

  // Time objection
  if (/אין זמן|עסוק|לוח זמנים|no time|busy|schedule/i.test(userContent)) {
    return 'time';
  }

  // Format objection
  if (/פרונטלי|זום|לא אוהב|מעדיף|prefer|don't like zoom|frontal/i.test(userContent)) {
    return 'format';
  }

  // Trust objection
  if (/לא בטוח|צריך לחשוב|אחזור|not sure|need to think|get back/i.test(userContent)) {
    return 'trust';
  }

  return 'none';
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Delete all messages for a lead
 *
 * @param leadId - Lead UUID
 * @returns Number of deleted messages
 */
export async function deleteAllMessagesForLead(leadId: string): Promise<number> {
  return MessageModel.deleteAllForLead(leadId);
}
