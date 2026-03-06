/**
 * Calendly Webhook Routes
 *
 * External webhook — NOT behind auth middleware.
 *
 * @routes
 * POST /webhook/calendly - Booking webhook handler
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { handleCalendlyWebhook } from '../controllers/calendly.controller.js';

const router = Router();

/**
 * POST /webhook/calendly
 *
 * Calendly sends invitee.created events here when a booking is made.
 * No auth required — external webhook endpoint.
 */
router.post('/', asyncHandler(handleCalendlyWebhook));

export default router;
