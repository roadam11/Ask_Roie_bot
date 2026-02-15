/**
 * Message Model - Data Access Layer
 *
 * Handles all database operations for messages with
 * idempotency support via whatsapp_message_id checks.
 *
 * @example
 * import * as MessageModel from './models/message.model.js';
 *
 * // Idempotent create - won't duplicate if whatsappMessageId exists
 * const msg = await MessageModel.create(leadId, 'user', 'Hello', {
 *   whatsappMessageId: 'wamid.xyz'
 * });
 *
 * const history = await MessageModel.getConversationHistory(leadId, 10);
 */

import { query, queryOne } from '../database/connection.js';
import logger from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Message role
 */
type MessageRole = 'user' | 'bot' | 'system';

/**
 * Message record from database
 */
interface Message {
  id: string;
  lead_id: string;
  role: MessageRole;
  content: string;
  whatsapp_message_id: string | null;
  tokens_used: number | null;
  model_used: string | null;
  created_at: Date;
}

/**
 * Options for creating a message
 */
interface CreateMessageOptions {
  whatsappMessageId?: string;
  tokensUsed?: number;
  modelUsed?: string;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new message with idempotency check
 *
 * If whatsappMessageId is provided and already exists,
 * returns the existing message instead of creating a duplicate.
 *
 * @param leadId - Lead UUID
 * @param role - Message role (user, bot, system)
 * @param content - Message content
 * @param options - Optional metadata
 * @returns The created or existing message
 */
export async function create(
  leadId: string,
  role: MessageRole,
  content: string,
  options?: CreateMessageOptions
): Promise<Message> {
  // Idempotency check: if whatsappMessageId provided, check if it exists
  if (options?.whatsappMessageId) {
    const existing = await findByWhatsAppId(options.whatsappMessageId);
    if (existing) {
      logger.debug('Message already exists (idempotency check)', {
        whatsappMessageId: options.whatsappMessageId,
        existingId: existing.id,
      });
      return existing;
    }
  }

  const sql = `
    INSERT INTO messages (lead_id, role, content, whatsapp_message_id, tokens_used, model_used)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;

  const values = [
    leadId,
    role,
    content,
    options?.whatsappMessageId || null,
    options?.tokensUsed || null,
    options?.modelUsed || null,
  ];

  try {
    const result = await query<Message>(sql, values);
    const message = result.rows[0];

    logger.debug('Message created', {
      messageId: message.id,
      leadId,
      role,
      contentLength: content.length,
      tokensUsed: options?.tokensUsed,
    });

    return message;
  } catch (error) {
    // Handle unique constraint violation (race condition)
    if ((error as { code?: string }).code === '23505') {
      // Another request created the same message, fetch and return it
      if (options?.whatsappMessageId) {
        const existing = await findByWhatsAppId(options.whatsappMessageId);
        if (existing) {
          logger.debug('Message created by concurrent request', {
            whatsappMessageId: options.whatsappMessageId,
          });
          return existing;
        }
      }
    }
    throw error;
  }
}

/**
 * Find a message by ID
 *
 * @param id - Message UUID
 * @returns The message or null if not found
 */
export async function findById(id: string): Promise<Message | null> {
  const sql = 'SELECT * FROM messages WHERE id = $1';
  return queryOne<Message>(sql, [id]);
}

/**
 * Find a message by WhatsApp message ID
 * Used for idempotency checks
 *
 * @param whatsappMessageId - WhatsApp message ID (wamid.xxx)
 * @returns The message or null if not found
 */
export async function findByWhatsAppId(
  whatsappMessageId: string
): Promise<Message | null> {
  const sql = 'SELECT * FROM messages WHERE whatsapp_message_id = $1';
  return queryOne<Message>(sql, [whatsappMessageId]);
}

/**
 * List messages for a lead
 *
 * @param leadId - Lead UUID
 * @param limit - Maximum number of messages to return
 * @returns Array of messages ordered by created_at DESC
 */
export async function listByLead(
  leadId: string,
  limit = 100
): Promise<Message[]> {
  const sql = `
    SELECT * FROM messages
    WHERE lead_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;

  const result = await query<Message>(sql, [leadId, limit]);
  return result.rows;
}

/**
 * Delete a message
 *
 * @param id - Message UUID
 * @returns true if deleted, false if not found
 */
export async function remove(id: string): Promise<boolean> {
  const sql = 'DELETE FROM messages WHERE id = $1 RETURNING id';
  const result = await query(sql, [id]);

  if (result.rowCount && result.rowCount > 0) {
    logger.debug('Message deleted', { messageId: id });
    return true;
  }

  return false;
}

// ============================================================================
// Conversation Helpers
// ============================================================================

/**
 * Get conversation history for a lead
 * Returns messages in chronological order (oldest first) for Claude context
 *
 * @param leadId - Lead UUID
 * @param limit - Maximum number of messages (default 20)
 * @returns Array of messages ordered chronologically (ASC)
 */
export async function getConversationHistory(
  leadId: string,
  limit = 20
): Promise<Message[]> {
  // Get last N messages in DESC order, then reverse for chronological
  const sql = `
    SELECT * FROM (
      SELECT * FROM messages
      WHERE lead_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    ) sub
    ORDER BY created_at ASC
  `;

  const result = await query<Message>(sql, [leadId, limit]);

  logger.debug('Retrieved conversation history', {
    leadId,
    messageCount: result.rows.length,
  });

  return result.rows;
}

/**
 * Get the last message from the user
 *
 * @param leadId - Lead UUID
 * @returns The last user message or null
 */
export async function getLastUserMessage(
  leadId: string
): Promise<Message | null> {
  const sql = `
    SELECT * FROM messages
    WHERE lead_id = $1 AND role = 'user'
    ORDER BY created_at DESC
    LIMIT 1
  `;

  return queryOne<Message>(sql, [leadId]);
}

/**
 * Get the last message from the bot
 *
 * @param leadId - Lead UUID
 * @returns The last bot message or null
 */
export async function getLastBotMessage(
  leadId: string
): Promise<Message | null> {
  const sql = `
    SELECT * FROM messages
    WHERE lead_id = $1 AND role = 'bot'
    ORDER BY created_at DESC
    LIMIT 1
  `;

  return queryOne<Message>(sql, [leadId]);
}

/**
 * Get the last message of any role
 *
 * @param leadId - Lead UUID
 * @returns The last message or null
 */
export async function getLastMessage(leadId: string): Promise<Message | null> {
  const sql = `
    SELECT * FROM messages
    WHERE lead_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `;

  return queryOne<Message>(sql, [leadId]);
}

/**
 * Count total messages for a lead
 *
 * @param leadId - Lead UUID
 * @returns Message count
 */
export async function countMessages(leadId: string): Promise<number> {
  const sql = 'SELECT COUNT(*)::int as count FROM messages WHERE lead_id = $1';
  const result = await queryOne<{ count: number }>(sql, [leadId]);
  return result?.count || 0;
}

/**
 * Count messages by role for a lead
 *
 * @param leadId - Lead UUID
 * @returns Object with counts by role
 */
export async function countMessagesByRole(
  leadId: string
): Promise<{ user: number; bot: number; system: number }> {
  const sql = `
    SELECT role, COUNT(*)::int as count
    FROM messages
    WHERE lead_id = $1
    GROUP BY role
  `;

  const result = await query<{ role: MessageRole; count: number }>(sql, [leadId]);

  const counts = { user: 0, bot: 0, system: 0 };
  for (const row of result.rows) {
    counts[row.role] = row.count;
  }

  return counts;
}

// ============================================================================
// Analytics Helpers
// ============================================================================

/**
 * Get total tokens used for a lead
 *
 * @param leadId - Lead UUID
 * @returns Total tokens used
 */
export async function getTotalTokensUsed(leadId: string): Promise<number> {
  const sql = `
    SELECT COALESCE(SUM(tokens_used), 0)::int as total
    FROM messages
    WHERE lead_id = $1
  `;

  const result = await queryOne<{ total: number }>(sql, [leadId]);
  return result?.total || 0;
}

/**
 * Get token usage statistics for a date range
 *
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Token usage stats
 */
export async function getTokenUsageStats(
  startDate: Date,
  endDate: Date
): Promise<{
  totalTokens: number;
  messageCount: number;
  avgTokensPerMessage: number;
}> {
  const sql = `
    SELECT
      COALESCE(SUM(tokens_used), 0)::int as total_tokens,
      COUNT(*)::int as message_count
    FROM messages
    WHERE created_at >= $1 AND created_at < $2
      AND tokens_used IS NOT NULL
  `;

  const result = await queryOne<{
    total_tokens: number;
    message_count: number;
  }>(sql, [startDate, endDate]);

  const totalTokens = result?.total_tokens || 0;
  const messageCount = result?.message_count || 0;

  return {
    totalTokens,
    messageCount,
    avgTokensPerMessage: messageCount > 0 ? Math.round(totalTokens / messageCount) : 0,
  };
}

/**
 * Check if a WhatsApp message has already been processed
 * Alias for findByWhatsAppId for clarity in webhook handlers
 *
 * @param whatsappMessageId - WhatsApp message ID
 * @returns true if already processed
 */
export async function isMessageProcessed(
  whatsappMessageId: string
): Promise<boolean> {
  const existing = await findByWhatsAppId(whatsappMessageId);
  return existing !== null;
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Delete all messages for a lead
 * Used when deleting a lead (cascades should handle this, but explicit is better)
 *
 * @param leadId - Lead UUID
 * @returns Number of deleted messages
 */
export async function deleteAllForLead(leadId: string): Promise<number> {
  const sql = 'DELETE FROM messages WHERE lead_id = $1';
  const result = await query(sql, [leadId]);

  const count = result.rowCount || 0;
  if (count > 0) {
    logger.info('Deleted messages for lead', { leadId, count });
  }

  return count;
}

// ============================================================================
// Exports
// ============================================================================

export type { Message, MessageRole, CreateMessageOptions };
