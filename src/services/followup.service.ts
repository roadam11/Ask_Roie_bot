/**
 * Follow-up Service
 *
 * Handles scheduling and sending automated follow-up messages.
 * All DB queries are parameterized and scoped through lead_id
 * (leads are inherently tenant-scoped via agent_id → account_id).
 *
 * Deduplication: Only 1 pending follow-up per lead is allowed.
 * Anti-spam:     max follow_up_count = 3 per lead (enforced by DB constraint).
 * 24h Window:    Aborts if NOW() − last_message_at > 24h (WhatsApp rule).
 */

import { query, queryOne } from '../database/connection.js';
import logger from '../utils/logger.js';
import { scheduleFollowUp as enqueueFollowUp } from '../workers/queue.js';
import type { Lead, FollowUp, FollowUpType } from '../types/index.js';

// Follow-up timing constants (in hours)
// 23h cooldown — sends BEFORE Meta's 24h free messaging window closes.
// After 24h, WhatsApp requires pre-approved template messages.
const FOLLOWUP_COOLDOWN_HOURS = 23;
const FOLLOWUP_INTERVALS: Record<FollowUpType, number> = {
  // Legacy types — 23h to stay within Meta's 24h window
  '24h': 23,
  '72h': 72,
  '7d': 168,
  // Automation types (in hours)
  'thinking_24h': 23,
  'trial_reminder_2h': 2,
  'trial_followup_24h': 23,
  'idle_48h': 48,
};

/**
 * Follow-up validation result
 */
interface CanScheduleResult {
  allowed: boolean;
  reason?: string;
  cooldownRemaining?: number;
}

// ============================================================================
// Internal DB Helpers
// ============================================================================

/**
 * Find a lead by ID (real DB query).
 */
async function findLeadById(leadId: string): Promise<Lead | null> {
  return queryOne<Lead>('SELECT * FROM leads WHERE id = $1', [leadId]);
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Check if a follow-up can be scheduled for a lead.
 *
 * Guards:
 * 1. Lead must exist.
 * 2. Lead must not be opted out / booked / lost.
 * 3. Cooldown (23h) must have passed since last follow-up.
 * 4. Deduplication: no other pending follow-up must exist for this lead.
 * 5. Anti-spam: lead.follow_up_count must be < 3.
 * 6. 24h Window: last_message_at must be within the last 24h.
 */
async function canScheduleFollowUp(leadId: string): Promise<CanScheduleResult> {
  const lead = await findLeadById(leadId);

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

  // Anti-spam: max 3 follow-ups per lead lifetime
  if ((lead.follow_up_count ?? 0) >= 3) {
    logger.info('[FOLLOWUP_SKIP] Max follow-ups reached', { leadId, count: lead.follow_up_count });
    return { allowed: false, reason: 'Max follow-ups reached (3)' };
  }

  // 24h Window: abort if last_user_message_at > 24h ago (WhatsApp rule)
  if (lead.last_user_message_at) {
    const hoursSinceLastMessage =
      (Date.now() - new Date(lead.last_user_message_at).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastMessage > 24) {
      logger.info('[FOLLOWUP_SKIP] Outside 24h messaging window', {
        leadId,
        hoursSinceLastMessage: hoursSinceLastMessage.toFixed(1),
      });
      return { allowed: false, reason: 'Outside 24h WhatsApp messaging window' };
    }
  }

  // Cooldown: 23h since last follow-up
  if (lead.last_followup_sent_at) {
    const hoursSinceLastFollowup =
      (Date.now() - new Date(lead.last_followup_sent_at).getTime()) / (1000 * 60 * 60);

    if (hoursSinceLastFollowup < FOLLOWUP_COOLDOWN_HOURS) {
      const cooldownRemaining = FOLLOWUP_COOLDOWN_HOURS - hoursSinceLastFollowup;
      logger.debug('[FOLLOWUP_SKIP] Cooldown active', {
        leadId,
        cooldownRemaining: cooldownRemaining.toFixed(1),
      });
      return {
        allowed: false,
        reason: 'Cooldown active',
        cooldownRemaining,
      };
    }
  }

  // Deduplication: reject if a pending follow-up already exists for this lead
  const existingPending = await queryOne<{ id: string }>(
    `SELECT id FROM followups WHERE lead_id = $1 AND status = 'pending' LIMIT 1`,
    [leadId],
  );
  if (existingPending) {
    return { allowed: false, reason: 'Pending follow-up already exists for this lead' };
  }

  return { allowed: true };
}

// ============================================================================
// Scheduling
// ============================================================================

/**
 * Schedule a follow-up message for a lead.
 *
 * Persists a row to the `followups` table and enqueues a BullMQ delayed job.
 * Returns null (and logs reason) if the lead cannot receive a follow-up.
 */
async function scheduleFollowUp(
  leadId: string,
  type: FollowUpType,
  templateName?: string
): Promise<FollowUp | null> {
  const canSchedule = await canScheduleFollowUp(leadId);

  if (!canSchedule.allowed) {
    logger.info('[FOLLOWUP_SKIP] Cannot schedule follow-up', {
      leadId,
      type,
      reason: canSchedule.reason,
    });
    return null;
  }

  const intervalHours = FOLLOWUP_INTERVALS[type];
  const scheduledFor = new Date(Date.now() + intervalHours * 60 * 60 * 1000);
  const delayMs = intervalHours * 60 * 60 * 1000;

  // Persist follow-up row
  const followUp = await queryOne<FollowUp>(
    `INSERT INTO followups (lead_id, type, scheduled_for, status, template_name)
     VALUES ($1, $2, $3, 'pending', $4)
     RETURNING *`,
    [leadId, type, scheduledFor, templateName ?? null],
  );

  if (!followUp) {
    throw new Error(`Failed to insert follow-up record for lead ${leadId}`);
  }

  // Enqueue BullMQ delayed job — deterministic jobId prevents duplicates
  await enqueueFollowUp(leadId, type as '24h' | '72h' | '7d', followUp.id, delayMs);

  logger.info('[FOLLOWUP_SCHEDULED] Follow-up scheduled', {
    followUpId: followUp.id,
    leadId,
    type,
    scheduledFor: scheduledFor.toISOString(),
    delayMs,
  });

  return followUp;
}

// ============================================================================
// Cancellation
// ============================================================================

/**
 * Cancel all pending follow-ups for a lead.
 * Called when lead books, opts out, or is marked as lost.
 *
 * @returns Count of cancelled rows
 */
async function cancelPendingFollowUps(leadId: string): Promise<number> {
  const result = await query(
    `UPDATE followups
     SET status = 'cancelled'
     WHERE lead_id = $1 AND status = 'pending'`,
    [leadId],
  );

  const count = result.rowCount ?? 0;

  if (count > 0) {
    logger.info('[FOLLOWUP_CANCELLED] Pending follow-ups cancelled', { leadId, count });
  }

  return count;
}

// ============================================================================
// Polling
// ============================================================================

/**
 * Query all pending follow-ups whose scheduled_for time has passed.
 * Used by the scheduler worker to dispatch follow-up jobs.
 */
async function processDueFollowUps(): Promise<FollowUp[]> {
  const result = await query<FollowUp>(
    `SELECT f.*
     FROM followups f
     INNER JOIN leads l ON l.id = f.lead_id
     WHERE f.status = 'pending'
       AND f.scheduled_for <= NOW()
       AND l.opted_out = FALSE
       AND l.status NOT IN ('booked', 'lost')
     ORDER BY f.scheduled_for ASC
     LIMIT 100`,
  );

  logger.debug('[FOLLOWUP] Due follow-ups found', { count: result.rows.length });

  return result.rows;
}

// ============================================================================
// Completion
// ============================================================================

/**
 * Get follow-up message content based on type and lead state.
 */
function getFollowUpMessage(type: FollowUpType, lead: Lead): string {
  switch (type) {
    case '24h':
      return `היי${lead.name ? ` ${lead.name}` : ''} 🙂 רציתי לבדוק אם יש לך שאלות נוספות או שאפשר לעזור בעוד משהו?`;

    case '72h':
      return `שלום 🙂 לא שמעתי ממך - עדיין מחפש/ת עזרה ב${lead.subjects?.[0] || 'לימודים'}? אשמח לעזור אם יש שאלות.`;

    case '7d':
      return `היי 🙂 עבר קצת זמן מאז שדיברנו. אם עדיין רלוונטי, אשמח לעזור. בהצלחה בכל מקרה!`;

    default:
      return 'היי 🙂 אשמח לעזור אם יש שאלות נוספות.';
  }
}

/**
 * Mark a follow-up as sent and update lead counters.
 *
 * Persists:
 *  - followups.status = 'sent', sent_at = NOW()
 *  - leads.last_followup_sent_at = NOW()
 *  - leads.follow_up_count incremented by 1
 *  - analytics event row
 */
async function markFollowUpSent(followUpId: string, leadId: string): Promise<void> {
  // Update followup status
  await query(
    `UPDATE followups
     SET status = 'sent', sent_at = NOW()
     WHERE id = $1`,
    [followUpId],
  );

  // Update lead counters
  await query(
    `UPDATE leads
     SET last_followup_sent_at = NOW(),
         follow_up_count = COALESCE(follow_up_count, 0) + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [leadId],
  );

  // Log to analytics (best-effort, non-blocking)
  query(
    `INSERT INTO analytics (event_type, lead_id, metadata)
     VALUES ('followup_sent', $1, $2::jsonb)`,
    [leadId, JSON.stringify({ followup_id: followUpId })],
  ).catch((err) => {
    logger.warn('[FOLLOWUP] Analytics log failed', {
      followUpId,
      leadId,
      error: (err as Error).message,
    });
  });

  logger.info('[FOLLOWUP_SENT] Follow-up marked as sent', { followUpId, leadId });
}

// ============================================================================
// Exports
// ============================================================================

export {
  canScheduleFollowUp,
  scheduleFollowUp,
  cancelPendingFollowUps,
  processDueFollowUps,
  getFollowUpMessage,
  markFollowUpSent,
  FOLLOWUP_COOLDOWN_HOURS,
  FOLLOWUP_INTERVALS,
};

export type { FollowUpType, CanScheduleResult };
