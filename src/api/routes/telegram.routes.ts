/**
 * Telegram Webhook Routes
 *
 * Handles Telegram Bot API webhook endpoints for
 * incoming messages and callback queries.
 *
 * Key differences from WhatsApp:
 * - No verification endpoint needed
 * - Simpler setup (just set webhook URL via bot API)
 * - No 24-hour window restrictions
 *
 * @routes
 * POST /webhook/telegram - Incoming update handler
 * GET  /webhook/telegram/info - Webhook status (for debugging)
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { handleUpdate } from '../controllers/telegram.controller.js';
import * as TelegramService from '../../services/telegram.service.js';
import config from '../../config/index.js';

// ============================================================================
// Router Setup
// ============================================================================

const router = Router();

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /webhook/telegram
 *
 * Incoming update webhook handler.
 * Receives all Telegram events (messages, callback queries, etc.)
 *
 * Body: Telegram Update object
 * @see https://core.telegram.org/bots/api#update
 *
 * @returns { ok: true }
 */
router.post('/', asyncHandler(handleUpdate));

/**
 * GET /webhook/telegram/info
 *
 * Get current webhook information (for debugging)
 *
 * @returns Webhook status information
 */
router.get('/info', asyncHandler(async (_req: Request, res: Response) => {
  const webhookInfo = await TelegramService.getWebhookInfo();
  const botInfo = await TelegramService.getMe();

  res.json({
    bot: botInfo,
    webhook: webhookInfo,
    configured: !!config.telegram.botToken,
  });
}));

/**
 * POST /webhook/telegram/setup
 *
 * Setup webhook URL (call this once after deployment)
 * Requires the webhook URL in the request body
 *
 * Body: { url: string }
 */
router.post('/setup', asyncHandler(async (req: Request, res: Response) => {
  const { url } = req.body;

  if (!url) {
    res.status(400).json({ error: 'Webhook URL is required' });
    return;
  }

  const success = await TelegramService.setWebhook(url);

  if (success) {
    res.json({ ok: true, message: 'Webhook set successfully', url });
  } else {
    res.status(500).json({ ok: false, error: 'Failed to set webhook' });
  }
}));

/**
 * DELETE /webhook/telegram/setup
 *
 * Remove webhook (switch to polling mode)
 */
router.delete('/setup', asyncHandler(async (_req: Request, res: Response) => {
  const success = await TelegramService.deleteWebhook();

  if (success) {
    res.json({ ok: true, message: 'Webhook removed' });
  } else {
    res.status(500).json({ ok: false, error: 'Failed to remove webhook' });
  }
}));

// ============================================================================
// Exports
// ============================================================================

export default router;
