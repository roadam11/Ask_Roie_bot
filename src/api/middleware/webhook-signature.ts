/**
 * WhatsApp Webhook Signature Verification Middleware
 *
 * Verifies Meta's X-Hub-Signature-256 header using HMAC-SHA256.
 * Meta signs every webhook payload with the App Secret.
 *
 * Header format: "sha256=<hex-digest>"
 *
 * Behavior:
 * - Valid signature → passes through to controller
 * - Invalid/missing signature → returns 200 OK (Meta requires it) but skips processing
 * - App Secret not configured (dev) → logs warning and passes through
 */

import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';

export function verifyWebhookSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const appSecret = config.whatsapp.appSecret;

  // Development bypass — allow testing without Meta
  if (!appSecret) {
    logger.warn('WhatsApp App Secret not configured — skipping signature verification');
    next();
    return;
  }

  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const rawBody = req.rawBody;

  if (!signature || !rawBody) {
    logger.warn('Webhook rejected: missing signature or raw body', {
      hasSignature: !!signature,
      hasRawBody: !!rawBody,
      ip: req.ip,
    });
    // Silent reject — Meta requires 200 OK
    res.status(200).send();
    return;
  }

  const expectedSignature =
    'sha256=' +
    crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  // Constant-time comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  const isValid =
    sigBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(sigBuffer, expectedBuffer);

  if (!isValid) {
    logger.warn('Webhook rejected: invalid signature', {
      received: signature.substring(0, 20) + '...',
      ip: req.ip,
    });
    // Silent reject — Meta requires 200 OK
    res.status(200).send();
    return;
  }

  next();
}
