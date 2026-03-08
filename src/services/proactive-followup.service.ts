/**
 * Proactive Follow-Up Service (Sprint 5.4)
 *
 * AI-generated contextual follow-ups for leads that go silent.
 * Fires at 23-24h after last user message — inside Meta's free messaging window.
 *
 * NOT the same as the template-based follow-ups in followup.worker.ts.
 * This generates a unique, contextual message via Haiku for each lead.
 *
 * SAFETY:
 * - No business hours filtering (prevents leads falling through 24h window)
 * - Max 1 per 23h cycle per lead (model='followup-ai' dedup)
 * - Max 3 lifetime per lead
 * - Fresh re-check before every send (race condition protection)
 * - Idempotent: running sweep twice = zero duplicates
 */

import Anthropic from '@anthropic-ai/sdk';
import config from '../config/index.js';
import { query, queryOne } from '../database/connection.js';
import * as WhatsAppService from './whatsapp.service.js';
import * as MessageService from './message.service.js';
import { getWebSocketServer } from '../realtime/ws-server.js';
import { emitLeadUpdated, emitOverviewRefresh, getAccountIdByLeadId } from '../realtime/emitter.js';
import logger from '../utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

/** Max AI follow-ups per lead (lifetime) */
const MAX_PROACTIVE_FOLLOWUPS = 3;

/** Rate limit delay between sends (ms) */
const SEND_DELAY_MS = 1000;

// ============================================================================
// Types
// ============================================================================

interface EligibleLead {
  id: string;
  name: string | null;
  phone: string;
  lead_state: string;
  conversation_id: string;
  ai_active: boolean;
}

// ============================================================================
// Step 1 — Find eligible leads (batch query)
// ============================================================================

/**
 * Find all leads eligible for proactive AI follow-up.
 * Single batch query — no N+1.
 *
 * Time window computed in Node.js (not Postgres NOW()) for timezone safety.
 */
async function findEligibleLeads(): Promise<EligibleLead[]> {
  const now = Date.now();
  const windowStart = new Date(now - 24 * 60 * 60 * 1000); // 24h ago
  const windowEnd = new Date(now - 23 * 60 * 60 * 1000);   // 23h ago

  const result = await query<EligibleLead>(
    `SELECT l.id, l.name, l.phone, l.lead_state,
            c.id AS conversation_id, c.ai_active
     FROM leads l
     JOIN conversations c ON c.lead_id = l.id
     WHERE l.deleted_at IS NULL
       AND l.lead_state NOT IN ('new', 'closed', 'converted')
       AND l.status NOT IN ('booked', 'lost')
       AND l.opted_out = false
       AND c.ai_active = true
       AND (
         SELECT MAX(m.created_at) FROM messages m
         WHERE m.conversation_id = c.id AND m.role = 'user'
       ) BETWEEN $1 AND $2
       AND NOT EXISTS (
         SELECT 1 FROM messages m2
         WHERE m2.conversation_id = c.id
           AND m2.model = 'followup-ai'
           AND m2.created_at > (
             SELECT MAX(m3.created_at) FROM messages m3
             WHERE m3.conversation_id = c.id AND m3.role = 'user'
           )
       )
     LIMIT 50`,
    [windowStart, windowEnd],
  );

  return result.rows;
}

// ============================================================================
// Step 2 — AI follow-up generation (Haiku, NOT main pipeline)
// ============================================================================

/**
 * Generate a contextual follow-up message using Haiku.
 * Returns empty string on failure (caller must skip).
 */
async function generateFollowUp(
  lead: EligibleLead,
  history: string,
): Promise<{ text: string; tokens: number }> {
  try {
    const client = new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 10_000 });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `אתה עוזר AI של עסק. הלקוח ${lead.name || 'לקוח'} התעניין בשירותים שלנו אבל הפסיק להגיב אתמול.
מצב הליד: ${lead.lead_state}.

היסטוריית השיחה (אחרונה):
${history}

כתוב הודעת WhatsApp קצרה מאוד (עד 15 מילים) בעברית טבעית שמזמינה את הלקוח לחזור לשיחה.
אל תהיה דוחק או אגרסיבי. תהיה חם ואנושי.
אל תציע מחירים או שירותים חדשים — רק תזכורת עדינה.

חשוב מאוד: החזר אך ורק את טקסט ההודעה, ללא מילות הקדמה, ללא גרשיים, ללא הסבר.`,
      }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const tokens = response.usage?.output_tokens ?? 0;
    return { text, tokens };
  } catch (err) {
    logger.error(`[FOLLOWUP_ERR] lead_id=${lead.id} generation_failed`, {
      error: (err as Error).message,
    });
    return { text: '', tokens: 0 };
  }
}

// ============================================================================
// Step 3 — Process a single lead
// ============================================================================

/**
 * Process a single lead for proactive follow-up.
 * Returns true if message was sent, false if skipped.
 */
async function processFollowUp(lead: EligibleLead): Promise<boolean> {
  const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000);

  // ── Guard: max 1 per 23h cycle ──
  const recentFollowUp = await queryOne<{ id: string }>(
    `SELECT id FROM messages
     WHERE conversation_id = $1 AND model = 'followup-ai'
       AND created_at > $2
     LIMIT 1`,
    [lead.conversation_id, twentyThreeHoursAgo],
  );
  if (recentFollowUp) {
    logger.info(`[FOLLOWUP_SKIP] lead_id=${lead.id} reason=already_sent_this_cycle`);
    return false;
  }

  // ── Guard: max 3 lifetime ──
  const totalFollowUps = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM messages
     WHERE conversation_id = $1 AND model = 'followup-ai'`,
    [lead.conversation_id],
  );
  if (parseInt(totalFollowUps?.count ?? '0', 10) >= MAX_PROACTIVE_FOLLOWUPS) {
    logger.info(`[FOLLOWUP_SKIP] lead_id=${lead.id} reason=lifetime_limit_reached`);
    return false;
  }

  // ── Load conversation context (last 4 messages) ──
  const messagesResult = await query<{ role: string; content: string }>(
    `SELECT role, content FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC LIMIT 4`,
    [lead.conversation_id],
  );
  let history = messagesResult.rows
    .reverse()
    .map((m) => `[${m.role}]: ${m.content}`)
    .join('\n');
  if (history.length > 1000) history = history.slice(-1000);

  // ── Generate AI follow-up ──
  const { text: followUpText, tokens } = await generateFollowUp(lead, history);

  // ── Validate output ──
  if (!followUpText || followUpText.length < 3 || followUpText.length > 200) {
    logger.warn(`[FOLLOWUP_SKIP] lead_id=${lead.id} reason=invalid_generation length=${followUpText?.length ?? 0}`);
    return false;
  }

  // ── Fresh re-check (race condition protection) ──
  const fresh = await queryOne<{
    lead_state: string;
    status: string;
    ai_active: boolean;
    last_user_msg: string;
  }>(
    `SELECT l.lead_state, l.status, c.ai_active,
            (SELECT MAX(created_at) FROM messages WHERE conversation_id = c.id AND role = 'user') AS last_user_msg
     FROM leads l
     JOIN conversations c ON c.lead_id = l.id
     WHERE l.id = $1`,
    [lead.id],
  );

  if (!fresh) return false;

  if (['new', 'closed', 'converted'].includes(fresh.lead_state)) {
    logger.info(`[FOLLOWUP_SKIP] lead_id=${lead.id} reason=state_changed state=${fresh.lead_state}`);
    return false;
  }
  if (['booked', 'lost'].includes(fresh.status)) {
    logger.info(`[FOLLOWUP_SKIP] lead_id=${lead.id} reason=status_changed status=${fresh.status}`);
    return false;
  }
  if (!fresh.ai_active) {
    logger.info(`[FOLLOWUP_SKIP] lead_id=${lead.id} reason=takeover_started`);
    return false;
  }
  const lastUserMsgMs = new Date(fresh.last_user_msg).getTime();
  const twentyThreeHoursAgoMs = Date.now() - 23 * 60 * 60 * 1000;
  if (lastUserMsgMs > twentyThreeHoursAgoMs) {
    logger.info(`[FOLLOWUP_SKIP] lead_id=${lead.id} reason=user_replied_during_sweep`);
    return false;
  }

  // ── Send via WhatsApp ──
  try {
    await WhatsAppService.sendTextMessage(lead.phone, followUpText);
    logger.info(`[FOLLOWUP_SENT] lead_id=${lead.id} phone=${lead.phone}`);
  } catch (err) {
    logger.error(`[FOLLOWUP_ERR] lead_id=${lead.id} send_failed`, {
      error: (err as Error).message,
    });
    return false; // Don't retry — Meta window might have closed
  }

  // ── Save to DB with 'followup-ai' marker ──
  await MessageService.createBotMessage(
    lead.id,
    followUpText,
    tokens,
    'followup-ai',       // model marker — used for dedup + analytics
    undefined,           // responseTimeMs
    undefined,           // toolCallsUsed
    lead.conversation_id,
  );

  // ── Update conversation stats ──
  try {
    await query(
      `UPDATE conversations
       SET message_count = message_count + 1,
           last_message = $1,
           last_message_at = NOW()
       WHERE id = $2`,
      [followUpText.substring(0, 500), lead.conversation_id],
    );
  } catch (err) {
    logger.warn(`[FOLLOWUP_ERR] lead_id=${lead.id} stats_update_failed`, {
      error: (err as Error).message,
    });
  }

  // ── WebSocket broadcast ──
  try {
    const wss = getWebSocketServer();
    if (wss) {
      const accountId = await getAccountIdByLeadId(lead.id);
      if (accountId) {
        emitLeadUpdated(wss, lead.id, accountId);
        emitOverviewRefresh(wss, accountId);
      }
    }
  } catch {
    // Non-critical — dashboard will sync on next poll
  }

  return true;
}

// ============================================================================
// Step 4 — Sweep (called by scheduler)
// ============================================================================

/**
 * Sweep all eligible leads and send proactive AI follow-ups.
 * Safe to call multiple times — idempotent via 'followup-ai' marker.
 */
export async function sweepProactiveFollowUps(): Promise<void> {
  const startTime = Date.now();

  try {
    const eligible = await findEligibleLeads();

    if (eligible.length === 0) {
      logger.debug('[FOLLOWUP_SWEEP] No eligible leads found');
      return;
    }

    let sent = 0;
    let skipped = 0;

    for (const lead of eligible) {
      try {
        const didSend = await processFollowUp(lead);
        if (didSend) sent++;
        else skipped++;
      } catch (err) {
        logger.error(`[FOLLOWUP_ERR] lead_id=${lead.id}`, {
          error: (err as Error).message,
        });
        skipped++;
      }

      // Rate limit: 1 second between sends (respect WhatsApp limits)
      if (sent > 0 || skipped > 0) {
        await new Promise((resolve) => setTimeout(resolve, SEND_DELAY_MS));
      }
    }

    logger.info(`[FOLLOWUP_SWEEP] duration_ms=${Date.now() - startTime} eligible=${eligible.length} sent=${sent} skipped=${skipped}`);
  } catch (err) {
    logger.error('[FOLLOWUP_SWEEP] sweep_failed', {
      error: (err as Error).message,
    });
  }
}
