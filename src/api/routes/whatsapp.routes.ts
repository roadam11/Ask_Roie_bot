/**
 * WhatsApp Webhook Routes
 *
 * Handles WhatsApp Cloud API webhook endpoints for
 * verification and incoming messages.
 *
 * @routes
 * GET  /webhook/whatsapp - Webhook verification
 * POST /webhook/whatsapp - Incoming message handler
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { verifyWebhookSignature } from '../middleware/webhook-signature.js';
import {
  verifyWebhook,
  handleIncomingMessage,
} from '../controllers/whatsapp.controller.js';

// ============================================================================
// Router Setup
// ============================================================================

const router = Router();

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /webhook/whatsapp
 *
 * WhatsApp webhook verification endpoint.
 * Called by WhatsApp when setting up the webhook.
 *
 * Query Parameters:
 * - hub.mode: Should be 'subscribe'
 * - hub.verify_token: Must match our configured token
 * - hub.challenge: Challenge string to return
 *
 * @returns The challenge string on success, 403 on failure
 */
router.get('/', verifyWebhook);

/**
 * POST /webhook/whatsapp
 *
 * Incoming message webhook handler.
 * Receives all WhatsApp events (messages, status updates, etc.)
 *
 * CRITICAL: Must respond with 200 OK quickly (within 20 seconds)
 * or WhatsApp will retry the request, potentially causing duplicates.
 *
 * Body: WhatsApp webhook payload
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 *
 * @returns { status: 'received' }
 */
router.post('/', verifyWebhookSignature, asyncHandler(handleIncomingMessage));

// ============================================================================
// Exports
// ============================================================================

export default router;
