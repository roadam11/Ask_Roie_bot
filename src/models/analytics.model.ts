/**
 * Analytics Model - Data Access Layer
 *
 * Handles all database operations for analytics events
 * including cost tracking and event aggregation.
 *
 * @example
 * import * as AnalyticsModel from './models/analytics.model.js';
 *
 * await AnalyticsModel.create('conversation_started', leadId);
 * await AnalyticsModel.create('claude_api_call', leadId, { tokens: 500 }, 0.015);
 * const costs = await AnalyticsModel.getTotalCost(startDate, endDate);
 */

import { query, queryOne } from '../database/connection.js';
import logger from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Analytics event record from database
 */
interface Analytics {
  id: string;
  event_type: string;
  lead_id: string | null;
  metadata: Record<string, unknown> | null;
  cost_usd: number | null;
  created_at: Date;
}

/**
 * Common event types
 */
export const EventTypes = {
  // Conversation events
  CONVERSATION_STARTED: 'conversation_started',
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_SENT: 'message_sent',

  // Lead events
  LEAD_CREATED: 'lead_created',
  LEAD_QUALIFIED: 'lead_qualified',
  LEAD_CONVERTED: 'lead_converted',
  LEAD_LOST: 'lead_lost',
  LEAD_OPTED_OUT: 'lead_opted_out',

  // Booking events
  BOOKING_LINK_SENT: 'booking_link_sent',
  BOOKING_COMPLETED: 'booking_completed',
  BOOKING_CANCELLED: 'booking_cancelled',

  // Follow-up events
  FOLLOWUP_SCHEDULED: 'followup_scheduled',
  FOLLOWUP_SENT: 'followup_sent',
  FOLLOWUP_CANCELLED: 'followup_cancelled',

  // API events
  CLAUDE_API_CALL: 'claude_api_call',
  WHATSAPP_API_CALL: 'whatsapp_api_call',
  CALENDLY_API_CALL: 'calendly_api_call',

  // Error events
  ERROR_OCCURRED: 'error_occurred',
  WEBHOOK_FAILED: 'webhook_failed',

  // Human handoff
  HUMAN_HANDOFF_REQUESTED: 'human_handoff_requested',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

/**
 * Filters for listing analytics
 */
interface ListFilters {
  eventType?: string;
  leadId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new analytics event
 *
 * @param eventType - Type of event
 * @param leadId - Optional lead UUID
 * @param metadata - Optional event metadata
 * @param costUsd - Optional cost in USD
 * @returns The created analytics event
 */
export async function create(
  eventType: string,
  leadId?: string,
  metadata?: Record<string, unknown>,
  costUsd?: number
): Promise<Analytics> {
  const sql = `
    INSERT INTO analytics (event_type, lead_id, metadata, cost_usd)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;

  const values = [
    eventType,
    leadId || null,
    metadata ? JSON.stringify(metadata) : null,
    costUsd || null,
  ];

  const result = await query<Analytics>(sql, values);
  const event = result.rows[0];

  logger.debug('Analytics event created', {
    eventId: event.id,
    eventType,
    leadId,
    costUsd,
  });

  return event;
}

/**
 * Find an analytics event by ID
 *
 * @param id - Analytics event UUID
 * @returns The event or null
 */
export async function findById(id: string): Promise<Analytics | null> {
  const sql = 'SELECT * FROM analytics WHERE id = $1';
  return queryOne<Analytics>(sql, [id]);
}

/**
 * Find analytics events for a lead
 *
 * @param leadId - Lead UUID
 * @param limit - Maximum number to return
 * @returns Array of analytics events
 */
export async function findByLead(
  leadId: string,
  limit = 100
): Promise<Analytics[]> {
  const sql = `
    SELECT * FROM analytics
    WHERE lead_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;

  const result = await query<Analytics>(sql, [leadId, limit]);
  return result.rows;
}

/**
 * Find analytics events by event type
 *
 * @param eventType - Event type to filter by
 * @param limit - Maximum number to return
 * @returns Array of analytics events
 */
export async function findByEventType(
  eventType: string,
  limit = 100
): Promise<Analytics[]> {
  const sql = `
    SELECT * FROM analytics
    WHERE event_type = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;

  const result = await query<Analytics>(sql, [eventType, limit]);
  return result.rows;
}

/**
 * List analytics events with filters
 *
 * @param filters - Optional filters
 * @returns Array of analytics events
 */
export async function list(filters?: ListFilters): Promise<Analytics[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (filters?.eventType) {
    conditions.push(`event_type = $${paramIndex++}`);
    values.push(filters.eventType);
  }

  if (filters?.leadId) {
    conditions.push(`lead_id = $${paramIndex++}`);
    values.push(filters.leadId);
  }

  if (filters?.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(filters.startDate);
  }

  if (filters?.endDate) {
    conditions.push(`created_at < $${paramIndex++}`);
    values.push(filters.endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit || 100;
  const offset = filters?.offset || 0;

  values.push(limit, offset);

  const sql = `
    SELECT * FROM analytics
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;

  const result = await query<Analytics>(sql, values);
  return result.rows;
}

// ============================================================================
// Analytics Helpers
// ============================================================================

/**
 * Count events by event type
 *
 * @param startDate - Optional start date
 * @param endDate - Optional end date
 * @returns Record of event type to count
 */
export async function countByEventType(
  startDate?: Date,
  endDate?: Date
): Promise<Record<string, number>> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(startDate);
  }

  if (endDate) {
    conditions.push(`created_at < $${paramIndex++}`);
    values.push(endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT event_type, COUNT(*)::int as count
    FROM analytics
    ${whereClause}
    GROUP BY event_type
    ORDER BY count DESC
  `;

  const result = await query<{ event_type: string; count: number }>(sql, values);

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[row.event_type] = row.count;
  }

  return counts;
}

/**
 * Get total cost for a date range
 *
 * @param startDate - Optional start date
 * @param endDate - Optional end date
 * @returns Total cost in USD
 */
export async function getTotalCost(
  startDate?: Date,
  endDate?: Date
): Promise<number> {
  const conditions: string[] = ['cost_usd IS NOT NULL'];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(startDate);
  }

  if (endDate) {
    conditions.push(`created_at < $${paramIndex++}`);
    values.push(endDate);
  }

  const sql = `
    SELECT COALESCE(SUM(cost_usd), 0)::float as total
    FROM analytics
    WHERE ${conditions.join(' AND ')}
  `;

  const result = await queryOne<{ total: number }>(sql, values);
  return result?.total || 0;
}

/**
 * Get cost breakdown by event type
 *
 * @param startDate - Optional start date
 * @param endDate - Optional end date
 * @returns Record of event type to cost
 */
export async function getCostByEventType(
  startDate?: Date,
  endDate?: Date
): Promise<Record<string, number>> {
  const conditions: string[] = ['cost_usd IS NOT NULL'];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(startDate);
  }

  if (endDate) {
    conditions.push(`created_at < $${paramIndex++}`);
    values.push(endDate);
  }

  const sql = `
    SELECT event_type, COALESCE(SUM(cost_usd), 0)::float as total
    FROM analytics
    WHERE ${conditions.join(' AND ')}
    GROUP BY event_type
    ORDER BY total DESC
  `;

  const result = await query<{ event_type: string; total: number }>(sql, values);

  const costs: Record<string, number> = {};
  for (const row of result.rows) {
    costs[row.event_type] = row.total;
  }

  return costs;
}

/**
 * Get events by date range
 *
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Array of analytics events
 */
export async function getEventsByDateRange(
  startDate: Date,
  endDate: Date
): Promise<Analytics[]> {
  const sql = `
    SELECT * FROM analytics
    WHERE created_at >= $1 AND created_at < $2
    ORDER BY created_at DESC
  `;

  const result = await query<Analytics>(sql, [startDate, endDate]);
  return result.rows;
}

/**
 * Get daily event counts for a date range
 *
 * @param startDate - Start date
 * @param endDate - End date
 * @param eventType - Optional event type filter
 * @returns Array of date and count
 */
export async function getDailyEventCounts(
  startDate: Date,
  endDate: Date,
  eventType?: string
): Promise<Array<{ date: string; count: number }>> {
  const conditions: string[] = [
    'created_at >= $1',
    'created_at < $2',
  ];
  const values: unknown[] = [startDate, endDate];

  if (eventType) {
    conditions.push('event_type = $3');
    values.push(eventType);
  }

  const sql = `
    SELECT
      DATE(created_at) as date,
      COUNT(*)::int as count
    FROM analytics
    WHERE ${conditions.join(' AND ')}
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;

  const result = await query<{ date: string; count: number }>(sql, values);
  return result.rows;
}

/**
 * Get daily costs for a date range
 *
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Array of date and cost
 */
export async function getDailyCosts(
  startDate: Date,
  endDate: Date
): Promise<Array<{ date: string; cost: number }>> {
  const sql = `
    SELECT
      DATE(created_at) as date,
      COALESCE(SUM(cost_usd), 0)::float as cost
    FROM analytics
    WHERE created_at >= $1
      AND created_at < $2
      AND cost_usd IS NOT NULL
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;

  const result = await query<{ date: string; cost: number }>(sql, [startDate, endDate]);
  return result.rows;
}

// ============================================================================
// Convenience Methods
// ============================================================================

/**
 * Track a conversation start
 */
export async function trackConversationStarted(leadId: string): Promise<Analytics> {
  return create(EventTypes.CONVERSATION_STARTED, leadId);
}

/**
 * Track a message received
 */
export async function trackMessageReceived(
  leadId: string,
  metadata?: { messageType?: string; contentLength?: number }
): Promise<Analytics> {
  return create(EventTypes.MESSAGE_RECEIVED, leadId, metadata);
}

/**
 * Track a message sent
 */
export async function trackMessageSent(
  leadId: string,
  metadata?: { messageType?: string; contentLength?: number }
): Promise<Analytics> {
  return create(EventTypes.MESSAGE_SENT, leadId, metadata);
}

/**
 * Track a Claude API call with cost
 */
export async function trackClaudeApiCall(
  leadId: string | undefined,
  inputTokens: number,
  outputTokens: number,
  model: string
): Promise<Analytics> {
  // Claude pricing (approximate, adjust as needed)
  // Sonnet: $3/1M input, $15/1M output
  const inputCost = (inputTokens / 1_000_000) * 3;
  const outputCost = (outputTokens / 1_000_000) * 15;
  const totalCost = inputCost + outputCost;

  return create(
    EventTypes.CLAUDE_API_CALL,
    leadId,
    { inputTokens, outputTokens, model },
    totalCost
  );
}

/**
 * Track a booking completion
 */
export async function trackBookingCompleted(
  leadId: string,
  calendlyEventUri?: string
): Promise<Analytics> {
  return create(EventTypes.BOOKING_COMPLETED, leadId, { calendlyEventUri });
}

/**
 * Track an error
 */
export async function trackError(
  errorType: string,
  errorMessage: string,
  leadId?: string,
  metadata?: Record<string, unknown>
): Promise<Analytics> {
  return create(EventTypes.ERROR_OCCURRED, leadId, {
    errorType,
    errorMessage,
    ...metadata,
  });
}

// ============================================================================
// Dashboard Helpers
// ============================================================================

/**
 * Get summary statistics for dashboard
 */
export async function getDashboardStats(
  startDate: Date,
  endDate: Date
): Promise<{
  totalEvents: number;
  totalCost: number;
  conversationsStarted: number;
  messagesReceived: number;
  messagesSent: number;
  bookingsCompleted: number;
  leadsConverted: number;
  errors: number;
}> {
  const counts = await countByEventType(startDate, endDate);
  const totalCost = await getTotalCost(startDate, endDate);

  return {
    totalEvents: Object.values(counts).reduce((a, b) => a + b, 0),
    totalCost,
    conversationsStarted: counts[EventTypes.CONVERSATION_STARTED] || 0,
    messagesReceived: counts[EventTypes.MESSAGE_RECEIVED] || 0,
    messagesSent: counts[EventTypes.MESSAGE_SENT] || 0,
    bookingsCompleted: counts[EventTypes.BOOKING_COMPLETED] || 0,
    leadsConverted: counts[EventTypes.LEAD_CONVERTED] || 0,
    errors: counts[EventTypes.ERROR_OCCURRED] || 0,
  };
}

// ============================================================================
// Exports
// ============================================================================

export type { Analytics, ListFilters };
