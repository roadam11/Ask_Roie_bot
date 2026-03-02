/**
 * Webhook Deduplication Service
 *
 * Prevents duplicate processing of webhook events from WhatsApp and Telegram.
 * Uses INSERT ... ON CONFLICT DO NOTHING for atomic, race-condition-safe dedup.
 *
 * Fail-open: if the DB query fails, we log a warning and treat the event as new
 * (better to risk a duplicate than to silently drop a message).
 */

import { query } from '../database/connection.js';
import logger from '../utils/logger.js';

type WebhookProvider = 'whatsapp' | 'telegram';

/**
 * Check whether a webhook event is new (not yet processed).
 *
 * Returns `true`  → NEW event, caller should process it.
 * Returns `false` → DUPLICATE event, caller should skip it.
 *
 * Mechanism: INSERT ... ON CONFLICT DO NOTHING.
 *   - If the row is inserted  → RETURNING returns a row  → rowCount > 0 → new.
 *   - If the row conflicts     → RETURNING returns nothing → rowCount = 0 → dup.
 */
export async function isNewWebhookEvent(
  provider: WebhookProvider,
  eventId: string,
): Promise<boolean> {
  try {
    const result = await query(
      `INSERT INTO processed_webhook_events (provider, event_id)
       VALUES ($1, $2)
       ON CONFLICT (provider, event_id) DO NOTHING
       RETURNING id`,
      [provider, eventId],
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    // Fail open — process the message rather than dropping it
    logger.warn('Webhook dedupe check failed, processing anyway', {
      provider,
      eventId,
      error: (error as Error).message,
    });
    return true;
  }
}
