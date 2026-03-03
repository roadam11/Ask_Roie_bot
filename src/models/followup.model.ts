/**
 * FollowUp Model - Data Access Layer
 *
 * Handles all database operations for follow-ups with
 * cooldown validation to prevent spamming users.
 *
 * @example
 * import * as FollowUpModel from './models/followup.model.js';
 *
 * const canSchedule = await FollowUpModel.canScheduleFollowUp(leadId);
 * if (canSchedule.allowed) {
 *   const followUp = await FollowUpModel.create(leadId, '24h', scheduledDate);
 * }
 *
 * const due = await FollowUpModel.findDueFollowUps(100);
 * for (const f of due) {
 *   await sendMessage(f);
 *   await FollowUpModel.markAsSent(f.id);
 * }
 */

import { query, queryOne } from '../database/connection.js';
import logger from '../utils/logger.js';
import * as LeadModel from './lead.model.js';
import type { FollowUp, FollowUpType, FollowUpStatus } from '../types/index.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Minimum hours between follow-ups to the same lead
 */
const FOLLOWUP_COOLDOWN_HOURS = 24;

// ============================================================================
// Types
// ============================================================================

/**
 * Result of cooldown check
 */
interface CooldownCheckResult {
  allowed: boolean;
  reason?: string;
  cooldownRemainingHours?: number;
}

/**
 * Options for creating a follow-up
 */
interface CreateFollowUpOptions {
  templateName?: string;
  messageTemplate?: string;
}

// ============================================================================
// Cooldown Validation
// ============================================================================

/**
 * Check if a follow-up can be scheduled for a lead
 *
 * Validates:
 * - Lead exists
 * - Lead has not opted out
 * - Lead is not already booked or lost
 * - Cooldown period (24h) has passed since last follow-up
 *
 * @param leadId - Lead UUID
 * @returns Cooldown check result
 */
export async function canScheduleFollowUp(
  leadId: string
): Promise<CooldownCheckResult> {
  const lead = await LeadModel.findById(leadId);

  if (!lead) {
    return { allowed: false, reason: 'Lead not found' };
  }

  if (lead.opted_out) {
    return { allowed: false, reason: 'Lead has opted out' };
  }

  if (lead.status === 'booked') {
    return { allowed: false, reason: 'Lead already booked' };
  }

  if (lead.status === 'lost') {
    return { allowed: false, reason: 'Lead marked as lost' };
  }

  // Check cooldown period
  if (lead.last_followup_sent_at) {
    const hoursSinceLastFollowup =
      (Date.now() - new Date(lead.last_followup_sent_at).getTime()) / (1000 * 60 * 60);

    if (hoursSinceLastFollowup < FOLLOWUP_COOLDOWN_HOURS) {
      const cooldownRemainingHours = FOLLOWUP_COOLDOWN_HOURS - hoursSinceLastFollowup;
      logger.debug('Follow-up cooldown active', {
        leadId,
        hoursSinceLastFollowup: hoursSinceLastFollowup.toFixed(1),
        cooldownRemainingHours: cooldownRemainingHours.toFixed(1),
      });
      return {
        allowed: false,
        reason: 'Cooldown active',
        cooldownRemainingHours,
      };
    }
  }

  // Check if there's already a pending follow-up
  const pendingFollowUps = await findPendingByLead(leadId);
  if (pendingFollowUps.length > 0) {
    return {
      allowed: false,
      reason: 'Pending follow-up already exists',
    };
  }

  return { allowed: true };
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new follow-up with cooldown validation
 *
 * @param leadId - Lead UUID
 * @param type - Follow-up type (24h, 72h, 7d)
 * @param scheduledFor - When to send the follow-up
 * @param options - Optional template info
 * @returns The created follow-up
 * @throws Error if cooldown is active or lead is invalid
 */
export async function create(
  leadId: string,
  type: FollowUpType,
  scheduledFor: Date,
  options?: CreateFollowUpOptions
): Promise<FollowUp> {
  // Validate cooldown
  const cooldownCheck = await canScheduleFollowUp(leadId);
  if (!cooldownCheck.allowed) {
    logger.warn('Cannot create follow-up: cooldown check failed', {
      leadId,
      reason: cooldownCheck.reason,
    });
    throw new Error(`Cannot schedule follow-up: ${cooldownCheck.reason}`);
  }

  const sql = `
    INSERT INTO followups (lead_id, type, scheduled_for, status, template_name, message_template)
    VALUES ($1, $2, $3, 'pending', $4, $5)
    RETURNING *
  `;

  const values = [
    leadId,
    type,
    scheduledFor,
    options?.templateName || null,
    options?.messageTemplate || null,
  ];

  const result = await query<FollowUp>(sql, values);
  const followUp = result.rows[0];

  logger.info('Follow-up created', {
    followUpId: followUp.id,
    leadId,
    type,
    scheduledFor: scheduledFor.toISOString(),
  });

  return followUp;
}

/**
 * Create a follow-up without cooldown validation
 * Use only for system-generated follow-ups (e.g., after booking)
 *
 * @param leadId - Lead UUID
 * @param type - Follow-up type
 * @param scheduledFor - When to send
 * @param options - Optional template info
 * @returns The created follow-up
 */
export async function createWithoutCooldown(
  leadId: string,
  type: FollowUpType,
  scheduledFor: Date,
  options?: CreateFollowUpOptions
): Promise<FollowUp> {
  const sql = `
    INSERT INTO followups (lead_id, type, scheduled_for, status, template_name, message_template)
    VALUES ($1, $2, $3, 'pending', $4, $5)
    RETURNING *
  `;

  const values = [
    leadId,
    type,
    scheduledFor,
    options?.templateName || null,
    options?.messageTemplate || null,
  ];

  const result = await query<FollowUp>(sql, values);
  const followUp = result.rows[0];

  logger.info('Follow-up created (without cooldown check)', {
    followUpId: followUp.id,
    leadId,
    type,
    scheduledFor: scheduledFor.toISOString(),
  });

  return followUp;
}

/**
 * Find a follow-up by ID
 *
 * @param id - Follow-up UUID
 * @returns The follow-up or null
 */
export async function findById(id: string): Promise<FollowUp | null> {
  const sql = 'SELECT * FROM followups WHERE id = $1';
  return queryOne<FollowUp>(sql, [id]);
}

/**
 * Find all follow-ups for a lead
 *
 * @param leadId - Lead UUID
 * @returns Array of follow-ups
 */
export async function findByLead(leadId: string): Promise<FollowUp[]> {
  const sql = `
    SELECT * FROM followups
    WHERE lead_id = $1
    ORDER BY scheduled_for DESC
  `;

  const result = await query<FollowUp>(sql, [leadId]);
  return result.rows;
}

/**
 * Find pending follow-ups for a lead
 *
 * @param leadId - Lead UUID
 * @returns Array of pending follow-ups
 */
export async function findPendingByLead(leadId: string): Promise<FollowUp[]> {
  const sql = `
    SELECT * FROM followups
    WHERE lead_id = $1 AND status = 'pending'
    ORDER BY scheduled_for ASC
  `;

  const result = await query<FollowUp>(sql, [leadId]);
  return result.rows;
}

/**
 * Find all pending follow-ups (for listing)
 *
 * @param limit - Maximum number to return
 * @returns Array of pending follow-ups
 */
export async function findPending(limit = 100): Promise<FollowUp[]> {
  const sql = `
    SELECT * FROM followups
    WHERE status = 'pending'
    ORDER BY scheduled_for ASC
    LIMIT $1
  `;

  const result = await query<FollowUp>(sql, [limit]);
  return result.rows;
}

/**
 * Update a follow-up
 *
 * @param id - Follow-up UUID
 * @param data - Fields to update
 * @returns The updated follow-up or null
 */
export async function update(
  id: string,
  data: { status?: FollowUpStatus; sent_at?: Date }
): Promise<FollowUp | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    values.push(data.status);
  }

  if (data.sent_at !== undefined) {
    updates.push(`sent_at = $${paramIndex++}`);
    values.push(data.sent_at);
  }

  if (updates.length === 0) {
    return findById(id);
  }

  values.push(id);

  const sql = `
    UPDATE followups
    SET ${updates.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = await query<FollowUp>(sql, values);
  return result.rows[0] || null;
}

/**
 * Cancel a follow-up
 *
 * @param id - Follow-up UUID
 * @returns true if cancelled, false if not found
 */
export async function cancel(id: string): Promise<boolean> {
  const sql = `
    UPDATE followups
    SET status = 'cancelled'
    WHERE id = $1 AND status = 'pending'
    RETURNING id
  `;

  const result = await query(sql, [id]);

  if (result.rowCount && result.rowCount > 0) {
    logger.info('Follow-up cancelled', { followUpId: id });
    return true;
  }

  return false;
}

/**
 * Cancel all pending follow-ups for a lead
 * Called when lead books, opts out, or is marked as lost
 *
 * @param leadId - Lead UUID
 * @returns Number of cancelled follow-ups
 */
export async function cancelAllForLead(leadId: string): Promise<number> {
  const sql = `
    UPDATE followups
    SET status = 'cancelled'
    WHERE lead_id = $1 AND status = 'pending'
  `;

  const result = await query(sql, [leadId]);
  const count = result.rowCount || 0;

  if (count > 0) {
    logger.info('Cancelled pending follow-ups for lead', { leadId, count });
  }

  return count;
}

/**
 * Delete a follow-up
 *
 * @param id - Follow-up UUID
 * @returns true if deleted
 */
export async function remove(id: string): Promise<boolean> {
  const sql = 'DELETE FROM followups WHERE id = $1 RETURNING id';
  const result = await query(sql, [id]);
  return (result.rowCount || 0) > 0;
}

// ============================================================================
// Worker Helpers
// ============================================================================

/**
 * Find follow-ups that are due to be sent
 * Returns follow-ups where scheduled_for <= NOW() and status = 'pending'
 *
 * @param limit - Maximum number to return
 * @returns Array of due follow-ups with lead info
 */
export async function findDueFollowUps(limit = 100): Promise<FollowUp[]> {
  const sql = `
    SELECT f.*
    FROM followups f
    INNER JOIN leads l ON f.lead_id = l.id AND l.deleted_at IS NULL
    WHERE f.status = 'pending'
      AND f.scheduled_for <= NOW()
      AND l.opted_out = FALSE
      AND l.status NOT IN ('booked', 'lost')
    ORDER BY f.scheduled_for ASC
    LIMIT $1
  `;

  const result = await query<FollowUp>(sql, [limit]);

  logger.debug('Found due follow-ups', { count: result.rows.length });

  return result.rows;
}

/**
 * Mark a follow-up as sent and update lead's last_followup_sent_at
 *
 * @param id - Follow-up UUID
 */
export async function markAsSent(id: string): Promise<void> {
  // Get the follow-up to find the lead_id
  const followUp = await findById(id);
  if (!followUp) {
    logger.warn('Cannot mark as sent: follow-up not found', { followUpId: id });
    return;
  }

  // Update follow-up status
  const updateFollowUpSql = `
    UPDATE followups
    SET status = 'sent', sent_at = NOW()
    WHERE id = $1
  `;
  await query(updateFollowUpSql, [id]);

  // Update lead's last_followup_sent_at
  const updateLeadSql = `
    UPDATE leads
    SET last_followup_sent_at = NOW(), updated_at = NOW()
    WHERE id = $1
  `;
  await query(updateLeadSql, [followUp.lead_id]);

  logger.info('Follow-up marked as sent', {
    followUpId: id,
    leadId: followUp.lead_id,
  });
}

/**
 * Mark a follow-up as failed (for retry logic)
 *
 * @param id - Follow-up UUID
 * @param error - Error message
 */
export async function markAsFailed(id: string, error: string): Promise<void> {
  // Note: The current schema doesn't have a 'failed' status
  // For now, we'll cancel it and log the error
  // Consider adding a 'failed' status and retry_count in future migrations

  const sql = `
    UPDATE followups
    SET status = 'cancelled'
    WHERE id = $1
  `;

  await query(sql, [id]);

  logger.error('Follow-up failed', {
    followUpId: id,
    error,
  });
}

// ============================================================================
// Analytics Helpers
// ============================================================================

/**
 * Get follow-up statistics
 *
 * @returns Stats by status and type
 */
export async function getStats(): Promise<{
  byStatus: Record<FollowUpStatus, number>;
  byType: Record<FollowUpType, number>;
  totalSent: number;
  avgDeliveryDelayMinutes: number;
}> {
  // Count by status
  const statusSql = `
    SELECT status, COUNT(*)::int as count
    FROM followups
    GROUP BY status
  `;
  const statusResult = await query<{ status: FollowUpStatus; count: number }>(statusSql, []);

  const byStatus: Record<FollowUpStatus, number> = {
    pending: 0,
    sent: 0,
    cancelled: 0,
  };
  for (const row of statusResult.rows) {
    byStatus[row.status] = row.count;
  }

  // Count by type
  const typeSql = `
    SELECT type, COUNT(*)::int as count
    FROM followups
    GROUP BY type
  `;
  const typeResult = await query<{ type: FollowUpType; count: number }>(typeSql, []);

  const byType: Record<FollowUpType, number> = {
    // Legacy types
    '24h': 0,
    '72h': 0,
    '7d': 0,
    // Automation types
    'thinking_24h': 0,
    'trial_reminder_2h': 0,
    'trial_followup_24h': 0,
    'idle_48h': 0,
  };
  for (const row of typeResult.rows) {
    byType[row.type] = row.count;
  }

  // Average delivery delay (how late were follow-ups sent)
  const delaySql = `
    SELECT AVG(EXTRACT(EPOCH FROM (sent_at - scheduled_for)) / 60)::float as avg_delay_minutes
    FROM followups
    WHERE status = 'sent' AND sent_at IS NOT NULL
  `;
  const delayResult = await queryOne<{ avg_delay_minutes: number }>(delaySql, []);

  return {
    byStatus,
    byType,
    totalSent: byStatus.sent,
    avgDeliveryDelayMinutes: Math.round(delayResult?.avg_delay_minutes || 0),
  };
}

// ============================================================================
// Exports
// ============================================================================

export type { CooldownCheckResult, CreateFollowUpOptions };
export { FOLLOWUP_COOLDOWN_HOURS };
