/**
 * Alerts Service - Generate system alerts
 */
import { query } from '../database/connection.js';

export async function generateAlerts(accountId: string): Promise<number> {
  let count = 0;

  count += await checkBookingIntentPending(accountId);
  count += await checkFollowupFailures(accountId);
  count += await checkHighFallbackRate(accountId);
  count += await checkLeadsWaiting24h(accountId);
  count += await checkLowConfidencePattern(accountId);
  count += await checkStuckConversations(accountId);

  return count;
}

async function checkBookingIntentPending(accountId: string): Promise<number> {
  const result = await query(
    `SELECT id, name, phone, updated_at 
     FROM leads 
     WHERE agent_id IN (SELECT id FROM agents WHERE account_id = $1)
       AND lead_state = 'booking_intent'
       AND updated_at < NOW() - INTERVAL '24 hours'`,
    [accountId]
  );
  const leads = result.rows;

  for (const lead of leads) {
    const hours = Math.floor((Date.now() - new Date(lead.updated_at as string).getTime()) / (1000 * 60 * 60));
    await createAlert(accountId, {
      severity: 'critical',
      type: 'booking_intent_pending',
      title: 'Booking Intent Pending',
      description: `${lead.name || lead.phone} ready to book for ${hours}h - needs attention`,
      reference_type: 'lead',
      reference_id: lead.id as string,
    });
  }

  return leads.length;
}

async function checkFollowupFailures(accountId: string): Promise<number> {
  const result = await query(
    `SELECT lead_id, COUNT(*) as failure_count
     FROM followups
     WHERE lead_id IN (
       SELECT id FROM leads WHERE agent_id IN (
         SELECT id FROM agents WHERE account_id = $1
       )
     )
     AND status = 'failed'
     AND created_at > NOW() - INTERVAL '7 days'
     GROUP BY lead_id
     HAVING COUNT(*) >= 3`,
    [accountId]
  );
  const failures = result.rows;

  for (const row of failures) {
    await createAlert(accountId, {
      severity: 'critical',
      type: 'followup_failures',
      title: 'Follow-up System Failures',
      description: `Follow-up failed ${row.failure_count} times - check configuration`,
      reference_type: 'lead',
      reference_id: row.lead_id as string,
    });
  }

  return failures.length;
}

async function checkHighFallbackRate(accountId: string): Promise<number> {
  const result = await query(
    `SELECT 
       COUNT(*) as total,
       COUNT(CASE WHEN is_fallback THEN 1 END) as fallbacks
     FROM ai_telemetry
     WHERE lead_id IN (
       SELECT id FROM leads WHERE agent_id IN (
         SELECT id FROM agents WHERE account_id = $1
       )
     )
     AND created_at > NOW() - INTERVAL '24 hours'`,
    [accountId]
  );

  const row = result.rows[0];
  if (row && Number(row.total) > 10) {
    const rate = (Number(row.fallbacks) / Number(row.total)) * 100;
    if (rate > 15) {
      await createAlert(accountId, {
        severity: 'critical',
        type: 'high_fallback_rate',
        title: 'High AI Fallback Rate',
        description: `AI fallback rate at ${rate.toFixed(1)}% - system needs review`,
      });
      return 1;
    }
  }

  return 0;
}

async function checkLeadsWaiting24h(accountId: string): Promise<number> {
  const result = await query(
    `SELECT id, name, phone, last_user_message_at
     FROM leads
     WHERE agent_id IN (SELECT id FROM agents WHERE account_id = $1)
       AND lead_state IN ('engaged', 'qualified')
       AND last_user_message_at < NOW() - INTERVAL '24 hours'
       AND (follow_up_scheduled_at IS NULL OR follow_up_scheduled_at > NOW())
       AND opted_out = FALSE`,
    [accountId]
  );
  const leads = result.rows;

  for (const lead of leads) {
    await createAlert(accountId, {
      severity: 'warning',
      type: 'lead_waiting',
      title: 'Lead Waiting 24h+',
      description: `${lead.name || lead.phone} waiting 24h+ without response`,
      reference_type: 'lead',
      reference_id: lead.id as string,
    });
  }

  return leads.length;
}

async function checkLowConfidencePattern(accountId: string): Promise<number> {
  const result = await query(
    `SELECT lead_id, COUNT(*) as low_count
     FROM ai_telemetry
     WHERE lead_id IN (
       SELECT id FROM leads WHERE agent_id IN (
         SELECT id FROM agents WHERE account_id = $1
       )
     )
     AND intent_confidence < 0.60
     AND created_at > NOW() - INTERVAL '24 hours'
     GROUP BY lead_id
     HAVING COUNT(*) >= 5`,
    [accountId]
  );
  const lowConfidence = result.rows;

  for (const row of lowConfidence) {
    await createAlert(accountId, {
      severity: 'warning',
      type: 'low_confidence_pattern',
      title: 'Low Confidence Pattern',
      description: `Repeated low-confidence AI responses - may need human review`,
      reference_type: 'lead',
      reference_id: row.lead_id as string,
    });
  }

  return lowConfidence.length;
}

async function checkStuckConversations(accountId: string): Promise<number> {
  const result = await query(
    `SELECT id, name, phone, updated_at
     FROM leads
     WHERE agent_id IN (SELECT id FROM agents WHERE account_id = $1)
       AND lead_state IN ('engaged', 'qualified', 'thinking')
       AND updated_at < NOW() - INTERVAL '48 hours'
       AND last_user_message_at < NOW() - INTERVAL '48 hours'
       AND (follow_up_scheduled_at IS NULL OR follow_up_scheduled_at > NOW())`,
    [accountId]
  );
  const stuck = result.rows;

  for (const lead of stuck) {
    await createAlert(accountId, {
      severity: 'warning',
      type: 'stuck_conversation',
      title: 'Conversation Stalled',
      description: `Conversation stalled 48h+ - consider manual outreach`,
      reference_type: 'lead',
      reference_id: lead.id as string,
    });
  }

  return stuck.length;
}

interface AlertData {
  severity: 'critical' | 'error' | 'warning' | 'info';
  type: string;
  title: string;
  description: string;
  reference_type?: 'lead' | 'conversation';
  reference_id?: string;
}

async function createAlert(accountId: string, alert: AlertData): Promise<void> {
  // Check if similar alert exists (last 24h)
  const existing = await query(
    `SELECT id FROM alerts
     WHERE type = $1
       AND account_id = $2
       AND reference_id = $3
       AND created_at > NOW() - INTERVAL '24 hours'
       AND status != 'resolved'`,
    [alert.type, accountId, alert.reference_id || null]
  );

  if (existing.rowCount && existing.rowCount > 0) {
    return; // Don't duplicate
  }

  await query(
    `INSERT INTO alerts (
      account_id, severity, alert_type, title, description, 
      reference_type, reference_id, status, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW())`,
    [
      accountId,
      alert.severity,
      alert.type,
      alert.title,
      alert.description,
      alert.reference_type || null,
      alert.reference_id || null,
    ]
  );
}
