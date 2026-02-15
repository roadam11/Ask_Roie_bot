/**
 * Follow-up Service
 * Handles scheduling and sending automated follow-up messages
 */

import type { Lead, FollowUp, FollowUpType } from '../types/index.js';

// Follow-up timing constants (in hours)
const FOLLOWUP_COOLDOWN_HOURS = 24;
const FOLLOWUP_INTERVALS: Record<FollowUpType, number> = {
  '24h': 24,
  '72h': 72,
  '7d': 168,
};

/**
 * Follow-up validation result
 */
interface CanScheduleResult {
  allowed: boolean;
  reason?: string;
  cooldownRemaining?: number;
}

/**
 * Check if a follow-up can be scheduled for a lead
 * Prevents spamming users with multiple follow-ups within 24 hours
 */
async function canScheduleFollowUp(leadId: string): Promise<CanScheduleResult> {
  // TODO: Replace with actual database query
  const lead = await findLeadById(leadId);

  if (!lead) {
    return { allowed: false, reason: 'Lead not found' };
  }

  // Don't schedule follow-ups for opted-out leads
  if (lead.opted_out) {
    return { allowed: false, reason: 'Lead has opted out' };
  }

  // Don't schedule follow-ups for booked leads
  if (lead.status === 'booked') {
    return { allowed: false, reason: 'Lead already booked' };
  }

  // Don't schedule follow-ups for lost leads
  if (lead.status === 'lost') {
    return { allowed: false, reason: 'Lead marked as lost' };
  }

  // Check if last follow-up was sent within 24 hours
  if (lead.last_followup_sent_at) {
    const hoursSinceLastFollowup =
      (Date.now() - lead.last_followup_sent_at.getTime()) / (1000 * 60 * 60);

    if (hoursSinceLastFollowup < FOLLOWUP_COOLDOWN_HOURS) {
      const cooldownRemaining = FOLLOWUP_COOLDOWN_HOURS - hoursSinceLastFollowup;
      console.log(`Cooldown active: ${cooldownRemaining.toFixed(1)}h remaining`);
      return {
        allowed: false,
        reason: 'Cooldown active',
        cooldownRemaining,
      };
    }
  }

  return { allowed: true };
}

/**
 * Schedule a follow-up message for a lead
 */
async function scheduleFollowUp(
  leadId: string,
  type: FollowUpType,
  templateName?: string
): Promise<FollowUp | null> {
  const canSchedule = await canScheduleFollowUp(leadId);

  if (!canSchedule.allowed) {
    console.log(`Cannot schedule follow-up for lead ${leadId}: ${canSchedule.reason}`);
    return null;
  }

  const intervalHours = FOLLOWUP_INTERVALS[type];
  const scheduledFor = new Date(Date.now() + intervalHours * 60 * 60 * 1000);

  const followUp: Partial<FollowUp> = {
    lead_id: leadId,
    type,
    scheduled_for: scheduledFor,
    status: 'pending',
    template_name: templateName,
    created_at: new Date(),
  };

  // TODO: Save to database
  console.log(`Scheduled ${type} follow-up for lead ${leadId} at ${scheduledFor.toISOString()}`);

  return followUp as FollowUp;
}

/**
 * Cancel all pending follow-ups for a lead
 * Called when lead books, opts out, or is marked as lost
 */
async function cancelPendingFollowUps(leadId: string): Promise<number> {
  // TODO: Update database
  console.log(`Cancelling pending follow-ups for lead ${leadId}`);

  // Return count of cancelled follow-ups
  return 0;
}

/**
 * Process due follow-ups
 * Called by BullMQ job processor
 */
async function processDueFollowUps(): Promise<void> {
  const now = new Date();

  // TODO: Query database for due follow-ups
  // SELECT * FROM followups
  // WHERE status = 'pending'
  // AND scheduled_for <= NOW()
  // ORDER BY scheduled_for ASC

  console.log(`Processing due follow-ups at ${now.toISOString()}`);
}

/**
 * Get follow-up message content based on type and lead state
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
 * Mark follow-up as sent and update lead
 */
async function markFollowUpSent(followUpId: string, leadId: string): Promise<void> {
  const now = new Date();

  // TODO: Update followup status
  // UPDATE followups SET status = 'sent', sent_at = NOW() WHERE id = ?

  // TODO: Update lead's last_followup_sent_at
  // UPDATE leads SET last_followup_sent_at = NOW() WHERE id = ?

  console.log(`Marked follow-up ${followUpId} as sent for lead ${leadId} at ${now.toISOString()}`);
}

// ============================================================================
// Database Helper Stubs (to be implemented with actual DB connection)
// ============================================================================

async function findLeadById(leadId: string): Promise<Lead | null> {
  // TODO: Implement with actual database query
  // SELECT * FROM leads WHERE id = $1
  console.log(`[STUB] Finding lead by ID: ${leadId}`);
  return null;
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
