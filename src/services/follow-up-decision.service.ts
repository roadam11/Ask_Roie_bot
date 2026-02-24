/**
 * Follow-up Decision Service
 *
 * Determines which follow-up to schedule based on lead state.
 * Handles priority, guards, and scheduling via BullMQ.
 *
 * CRITICAL: UTC math only - prevents 2AM messages
 */

import type { Lead, AutomationFollowUpType, LeadState } from '../types/index.js';
import {
  scheduleAutomationFollowUp,
  cancelAutomationFollowUp,
  cancelAllAutomationFollowUps,
} from '../workers/queue.js';
import {
  calculateFollowUpTime,
  getFollowUpPriority,
  hasHigherPriority,
  FOLLOW_UP_PRIORITIES,
} from '../prompts/follow-up-messages.js';
import { query, queryOne } from '../database/connection.js';
import logger from '../utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum follow-ups per lead (spam prevention) */
const MAX_FOLLOW_UPS = 3;

/** Hours to block automation after human contact */
const HUMAN_OVERRIDE_HOURS = 48;

/** Minimum hours between idle checks */
const IDLE_THRESHOLD_HOURS = 48;

/** Maximum hours for idle follow-up (don't chase too long) */
const IDLE_MAX_HOURS = 72;

// ============================================================================
// Types
// ============================================================================

export interface FollowUpDecision {
  /** Whether a follow-up should be scheduled */
  shouldSchedule: boolean;
  /** Type of follow-up to schedule */
  type?: AutomationFollowUpType;
  /** When to send (UTC) */
  scheduledAt?: Date;
  /** Priority level */
  priority?: number;
  /** Reason if not scheduling */
  reason?: string;
}

export interface ScheduleResult {
  success: boolean;
  jobId?: string;
  followUpId?: string;
  error?: string;
}

// ============================================================================
// Guard Checks
// ============================================================================

/**
 * Check if lead is eligible for any follow-up
 */
function checkEligibility(lead: Lead): { eligible: boolean; reason?: string } {
  // Opted out - never send
  if (lead.opted_out) {
    return { eligible: false, reason: 'Lead has opted out' };
  }

  // Already converted - no need
  if (lead.lead_state === 'converted') {
    return { eligible: false, reason: 'Lead already converted' };
  }

  // Closed/lost - don't chase
  if (lead.lead_state === 'closed') {
    return { eligible: false, reason: 'Lead is closed' };
  }

  // Max follow-ups reached
  if ((lead.follow_up_count ?? 0) >= MAX_FOLLOW_UPS) {
    return { eligible: false, reason: `Max follow-ups reached (${MAX_FOLLOW_UPS})` };
  }

  // Human override - Roie contacted recently
  if (lead.human_contacted_at) {
    const hoursSinceHuman = (Date.now() - new Date(lead.human_contacted_at).getTime()) / (1000 * 60 * 60);
    if (hoursSinceHuman < HUMAN_OVERRIDE_HOURS) {
      return {
        eligible: false,
        reason: `Human contacted ${Math.round(hoursSinceHuman)}h ago (wait ${HUMAN_OVERRIDE_HOURS}h)`,
      };
    }
  }

  // Needs human followup flag set
  if (lead.needs_human_followup) {
    return { eligible: false, reason: 'Lead flagged for human follow-up' };
  }

  return { eligible: true };
}

/**
 * Check if new follow-up should override existing
 */
function shouldOverrideExisting(
  lead: Lead,
  newType: AutomationFollowUpType
): { override: boolean; reason?: string } {
  // No existing follow-up
  if (!lead.follow_up_scheduled_at || !lead.follow_up_type) {
    return { override: true };
  }

  // Check priority
  const existingType = lead.follow_up_type as AutomationFollowUpType;
  if (hasHigherPriority(newType, existingType)) {
    return {
      override: true,
      reason: `Higher priority: ${newType} (${getFollowUpPriority(newType)}) > ${existingType} (${getFollowUpPriority(existingType)})`,
    };
  }

  return {
    override: false,
    reason: `Lower/equal priority: ${newType} (${getFollowUpPriority(newType)}) <= ${existingType} (${getFollowUpPriority(existingType)})`,
  };
}

// ============================================================================
// Decision Logic
// ============================================================================

/**
 * Decide which follow-up to schedule based on lead state
 * CRITICAL: UTC math only - prevents 2AM messages
 */
export function decideFollowUp(lead: Lead): FollowUpDecision {
  // Check basic eligibility
  const eligibility = checkEligibility(lead);
  if (!eligibility.eligible) {
    return { shouldSchedule: false, reason: eligibility.reason };
  }

  const now = new Date();

  // Priority 1: Trial reminder (2h before scheduled trial)
  if (lead.lead_state === 'trial_scheduled' && lead.trial_scheduled_at) {
    const trialTime = new Date(lead.trial_scheduled_at);
    const hoursUntilTrial = (trialTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Only schedule if trial is in the future and more than 2h away
    if (hoursUntilTrial > 2) {
      const scheduledAt = calculateFollowUpTime('trial_reminder_2h', trialTime);
      return {
        shouldSchedule: true,
        type: 'trial_reminder_2h',
        scheduledAt,
        priority: FOLLOW_UP_PRIORITIES.trial_reminder_2h,
      };
    }
  }

  // Priority 2: Trial follow-up (24h after completed trial)
  if (lead.trial_completed_at) {
    const completedTime = new Date(lead.trial_completed_at);
    const hoursSinceTrialComplete = (now.getTime() - completedTime.getTime()) / (1000 * 60 * 60);

    // Schedule if trial completed less than 24h ago (will send at 24h mark)
    if (hoursSinceTrialComplete < 24) {
      const scheduledAt = calculateFollowUpTime('trial_followup_24h', completedTime);
      return {
        shouldSchedule: true,
        type: 'trial_followup_24h',
        scheduledAt,
        priority: FOLLOW_UP_PRIORITIES.trial_followup_24h,
      };
    }
  }

  // Priority 3: Thinking follow-up (24h after "אחשוב")
  if (lead.lead_state === 'thinking') {
    // Use updated_at as proxy for when they said "אחשוב"
    const thinkingTime = new Date(lead.updated_at);
    const scheduledAt = calculateFollowUpTime('thinking_24h', thinkingTime);

    logger.info('Thinking follow-up check', {
      leadId: lead.id,
      thinkingTime: thinkingTime.toISOString(),
      scheduledAt: scheduledAt.toISOString(),
      now: now.toISOString(),
      willSchedule: scheduledAt.getTime() > now.getTime(),
    });

    // Only schedule if not already past the send time
    if (scheduledAt.getTime() > now.getTime()) {
      return {
        shouldSchedule: true,
        type: 'thinking_24h',
        scheduledAt,
        priority: FOLLOW_UP_PRIORITIES.thinking_24h,
      };
    }
  }

  // Priority 4: Idle follow-up (48h no response)
  if (lead.last_user_message_at && lead.lead_state === 'engaged') {
    const lastMessageTime = new Date(lead.last_user_message_at);
    const hoursSinceLastMessage = (now.getTime() - lastMessageTime.getTime()) / (1000 * 60 * 60);

    // Between 48-72h of idle: schedule idle follow-up
    if (hoursSinceLastMessage >= IDLE_THRESHOLD_HOURS && hoursSinceLastMessage < IDLE_MAX_HOURS) {
      // Send soon (1 second delay to go through queue)
      const scheduledAt = new Date(now.getTime() + 1000);
      return {
        shouldSchedule: true,
        type: 'idle_48h',
        scheduledAt,
        priority: FOLLOW_UP_PRIORITIES.idle_48h,
      };
    }
  }

  return { shouldSchedule: false, reason: 'No follow-up conditions met' };
}

// ============================================================================
// Scheduling Functions
// ============================================================================

/**
 * Schedule a follow-up for a lead
 * Handles priority override and database updates
 *
 * @param lead - Lead to schedule follow-up for
 * @param decision - Follow-up decision (or auto-decide if not provided)
 * @returns Schedule result
 */
export async function scheduleFollowUpForLead(
  lead: Lead,
  decision?: FollowUpDecision
): Promise<ScheduleResult> {
  try {
    // Get decision if not provided
    const followUpDecision = decision ?? decideFollowUp(lead);

    if (!followUpDecision.shouldSchedule) {
      logger.debug('No follow-up scheduled', {
        leadId: lead.id,
        reason: followUpDecision.reason,
      });
      return { success: false, error: followUpDecision.reason };
    }

    const { type, scheduledAt, priority } = followUpDecision;
    if (!type || !scheduledAt) {
      return { success: false, error: 'Missing type or scheduledAt in decision' };
    }

    // Check if should override existing
    const override = shouldOverrideExisting(lead, type);
    if (!override.override) {
      logger.debug('Follow-up not scheduled - existing has higher priority', {
        leadId: lead.id,
        newType: type,
        existingType: lead.follow_up_type,
        reason: override.reason,
      });
      return { success: false, error: override.reason };
    }

    // Cancel existing follow-up if overriding
    if (lead.follow_up_type) {
      await cancelAutomationFollowUp(lead.id, lead.follow_up_type as AutomationFollowUpType);
    }

    // Create follow-up record in database (for analytics/audit)
    const followUpId = await createFollowUpRecord(lead.id, type, scheduledAt, priority ?? 50);

    // Schedule BullMQ job
    const jobId = await scheduleAutomationFollowUp(lead.id, type, scheduledAt, followUpId);

    // Update lead with scheduled follow-up info
    await updateLeadFollowUpState(lead.id, type, scheduledAt, priority ?? 50, jobId);

    logger.info('Follow-up scheduled successfully', {
      leadId: lead.id,
      type,
      scheduledAtUtc: scheduledAt.toISOString(),
      priority,
      jobId,
      followUpId,
    });

    return { success: true, jobId, followUpId };
  } catch (error) {
    logger.error('Failed to schedule follow-up', {
      leadId: lead.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Cancel all pending follow-ups for a lead
 * Called when user responds or opts out
 */
export async function cancelFollowUpsForLead(leadId: string): Promise<void> {
  try {
    // Cancel BullMQ jobs
    const cancelled = await cancelAllAutomationFollowUps(leadId);

    // Update lead state
    await query(
      `UPDATE leads SET
        follow_up_scheduled_at = NULL,
        follow_up_type = NULL,
        follow_up_priority = NULL
      WHERE id = $1`,
      [leadId]
    );

    // Cancel pending follow-ups in database
    await query(
      `UPDATE followups SET status = 'cancelled' WHERE lead_id = $1 AND status = 'pending'`,
      [leadId]
    );

    logger.info('Cancelled all follow-ups for lead', { leadId, jobsCancelled: cancelled });
  } catch (error) {
    logger.error('Failed to cancel follow-ups', {
      leadId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Handle user response - cancel pending follow-ups
 * Called from message controllers when user sends a message
 */
export async function onUserResponse(leadId: string): Promise<void> {
  await cancelFollowUpsForLead(leadId);

  // Update last_user_message_at and lead_state
  await query(
    `UPDATE leads SET
      last_user_message_at = NOW(),
      lead_state = CASE
        WHEN lead_state = 'new' THEN 'engaged'
        WHEN lead_state = 'thinking' THEN 'engaged'
        ELSE lead_state
      END
    WHERE id = $1`,
    [leadId]
  );

  logger.debug('Processed user response', { leadId });
}

/**
 * Handle lead state change - may trigger new follow-up
 */
export async function onLeadStateChange(
  leadId: string,
  newState: LeadState,
  additionalData?: {
    trialScheduledAt?: Date;
    trialCompletedAt?: Date;
  }
): Promise<ScheduleResult | null> {
  logger.info('onLeadStateChange called', { leadId, newState, additionalData });

  try {
    // Get updated lead
    const lead = await queryOne<Lead>(
      `SELECT * FROM leads WHERE id = $1`,
      [leadId]
    );

    if (!lead) {
      logger.warn('Lead not found for state change', { leadId, newState });
      return null;
    }

    logger.info('Lead fetched for follow-up decision', {
      leadId,
      lead_state: lead.lead_state,
      follow_up_count: lead.follow_up_count,
      opted_out: lead.opted_out,
    });

    // Update trial timestamps if provided
    if (additionalData?.trialScheduledAt) {
      await query(
        `UPDATE leads SET trial_scheduled_at = $1 WHERE id = $2`,
        [additionalData.trialScheduledAt, leadId]
      );
      lead.trial_scheduled_at = additionalData.trialScheduledAt;
    }

    if (additionalData?.trialCompletedAt) {
      await query(
        `UPDATE leads SET trial_completed_at = $1 WHERE id = $2`,
        [additionalData.trialCompletedAt, leadId]
      );
      lead.trial_completed_at = additionalData.trialCompletedAt;
    }

    // If state is closed/converted, cancel all follow-ups
    if (newState === 'closed' || newState === 'converted') {
      await cancelFollowUpsForLead(leadId);
      return null;
    }

    // Decide and schedule new follow-up
    return await scheduleFollowUpForLead(lead);
  } catch (error) {
    logger.error('Failed to handle lead state change', {
      leadId,
      newState,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

// ============================================================================
// Database Helpers
// ============================================================================

/**
 * Create follow-up record in database (for analytics)
 */
async function createFollowUpRecord(
  leadId: string,
  type: AutomationFollowUpType,
  scheduledFor: Date,
  priority: number
): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO followups (lead_id, type, scheduled_for, status, priority)
     VALUES ($1, $2, $3, 'pending', $4)
     RETURNING id`,
    [leadId, type, scheduledFor, priority]
  );

  return result!.id;
}

/**
 * Update lead's follow-up state
 */
async function updateLeadFollowUpState(
  leadId: string,
  type: AutomationFollowUpType,
  scheduledAt: Date,
  priority: number,
  _jobId: string
): Promise<void> {
  await query(
    `UPDATE leads SET
      follow_up_scheduled_at = $1,
      follow_up_type = $2,
      follow_up_priority = $3
    WHERE id = $4`,
    [scheduledAt, type, priority, leadId]
  );
}

/**
 * Mark follow-up as sent and increment counter
 */
export async function markFollowUpSent(
  leadId: string,
  followUpId: string
): Promise<void> {
  // Update follow-up record
  await query(
    `UPDATE followups SET status = 'sent', sent_at = NOW() WHERE id = $1`,
    [followUpId]
  );

  // Update lead - increment count and clear scheduled
  await query(
    `UPDATE leads SET
      follow_up_count = COALESCE(follow_up_count, 0) + 1,
      follow_up_scheduled_at = NULL,
      follow_up_type = NULL,
      follow_up_priority = NULL,
      last_followup_sent_at = NOW()
    WHERE id = $1`,
    [leadId]
  );

  logger.debug('Marked follow-up as sent', { leadId, followUpId });
}

/**
 * Set human contacted timestamp (blocks automation for 48h)
 */
export async function setHumanContacted(leadId: string): Promise<void> {
  await query(
    `UPDATE leads SET human_contacted_at = NOW() WHERE id = $1`,
    [leadId]
  );

  // Cancel any pending automation
  await cancelFollowUpsForLead(leadId);

  logger.info('Human contact recorded, automation paused', { leadId });
}

// ============================================================================
// Idle Lead Detection (for scheduler)
// ============================================================================

/**
 * Find leads that are idle and need follow-up
 * Called by scheduler to detect 48h idle leads
 */
export async function findIdleLeads(): Promise<Lead[]> {
  const result = await query<Lead>(
    `SELECT * FROM leads
     WHERE lead_state = 'engaged'
       AND opted_out = false
       AND needs_human_followup = false
       AND COALESCE(follow_up_count, 0) < $1
       AND last_user_message_at IS NOT NULL
       AND last_user_message_at < NOW() - INTERVAL '${IDLE_THRESHOLD_HOURS} hours'
       AND last_user_message_at > NOW() - INTERVAL '${IDLE_MAX_HOURS} hours'
       AND follow_up_scheduled_at IS NULL
       AND (human_contacted_at IS NULL OR human_contacted_at < NOW() - INTERVAL '${HUMAN_OVERRIDE_HOURS} hours')
     ORDER BY last_user_message_at ASC
     LIMIT 50`,
    [MAX_FOLLOW_UPS]
  );

  return result.rows;
}

// ============================================================================
// Exports
// ============================================================================

export {
  checkEligibility,
  shouldOverrideExisting,
  MAX_FOLLOW_UPS,
  HUMAN_OVERRIDE_HOURS,
  IDLE_THRESHOLD_HOURS,
};
