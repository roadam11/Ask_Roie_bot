/**
 * Calendly Webhook Controller
 *
 * Handles Calendly webhook events for booking confirmations.
 * Updates lead status and sends WhatsApp confirmation.
 *
 * CRITICAL: Returns 200 immediately. All errors caught and logged.
 */

import { Request, Response } from 'express';
import logger from '../../utils/logger.js';
import { normalizePhoneSafe } from '../../utils/phone-normalizer.js';
import * as LeadModel from '../../models/lead.model.js';
import * as WhatsAppService from '../../services/whatsapp.service.js';
import { transaction } from '../../database/connection.js';
import { getWebSocketServer } from '../../realtime/ws-server.js';
import {
  emitLeadUpdated,
  emitOverviewRefresh,
  getAccountIdByLeadId,
} from '../../realtime/emitter.js';

// ============================================================================
// Webhook Handler
// ============================================================================

/**
 * Handle incoming Calendly webhook (POST /webhook/calendly)
 *
 * Design:
 * - Returns 200 immediately (external webhook)
 * - Idempotent (safe to receive same event twice)
 * - Never crashes — all errors caught and logged
 */
export async function handleCalendlyWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  // Acknowledge immediately
  res.status(200).json({ status: 'received' });

  try {
    const { event, payload } = req.body;

    // Only process booking creation
    if (event !== 'invitee.created') {
      logger.debug('[CAL_SKIP] Non-booking event', { event });
      return;
    }

    // Validate required fields
    if (!payload?.invitee || !payload?.scheduled_event) {
      logger.warn('[CAL_ERR] invalid_payload — missing invitee or scheduled_event');
      return;
    }

    // Extract phone
    const phone = normalizePhoneSafe(payload.invitee?.text_reminder_number || '');
    if (!phone) {
      logger.warn('[CAL_ERR] no_phone_in_webhook', {
        email: payload.invitee?.email,
      });
      return;
    }

    // Find lead by phone
    const lead = await LeadModel.findByPhone(phone);
    if (!lead) {
      logger.warn(`[CAL_ERR] no_lead_found phone=${maskPhone(phone)}`);
      return;
    }

    // Race-safe status update using SELECT FOR UPDATE in transaction
    const updated = await transaction(async (client) => {
      // Lock the row — prevents concurrent webhook from reading it
      const result = await client.query(
        'SELECT id, status, booking_completed FROM leads WHERE id = $1 FOR UPDATE',
        [lead.id],
      );

      const currentLead = result.rows[0];

      // Idempotency: skip if already booked
      if (currentLead?.booking_completed) {
        logger.info(`[CAL_SKIP] lead_id=${lead.id} already_booked=true`);
        return false;
      }

      // Update status
      await client.query(
        `UPDATE leads SET status = 'booked', booking_completed = true,
         trial_scheduled_at = $1 WHERE id = $2`,
        [payload.scheduled_event?.start_time, lead.id],
      );

      return true;
    });

    if (!updated) return;

    logger.info(`[CAL_BOOK] lead_id=${lead.id} phone=${maskPhone(phone)} time=${payload.scheduled_event?.start_time}`);

    // WebSocket broadcast
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
      // Non-critical — dashboard will refresh
    }

    // WhatsApp confirmation (optional UX, never breaks webhook)
    try {
      const startTime = new Date(payload.scheduled_event.start_time);
      const formatted = startTime.toLocaleString('he-IL', {
        weekday: 'long',
        day: 'numeric',
        month: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      await WhatsAppService.sendTextMessage(
        phone,
        `השיעור נקבע! 🎉\n${formatted}\nנתראה!`,
      );
      logger.info(`[CAL_CONFIRM] lead_id=${lead.id} sent=true`);
    } catch (err) {
      logger.error(`[CAL_ERR] confirmation_failed lead_id=${lead.id} error=${(err as Error).message}`);
      // Do NOT rethrow — confirmation failure must not break webhook
    }
  } catch (error) {
    logger.error('[CAL_ERR] Unhandled error in handleCalendlyWebhook', {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
}

// ============================================================================
// Helpers
// ============================================================================

function maskPhone(phone: string): string {
  if (phone.length < 8) return phone;
  return phone.slice(0, 4) + '****' + phone.slice(-4);
}
