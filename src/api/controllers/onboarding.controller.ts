/**
 * Onboarding Controller
 *
 * Guided setup flow for new tenants:
 * GET  /api/onboarding/status          — current step + milestones
 * POST /api/onboarding/complete-step   — advance step
 * GET  /api/onboarding/whatsapp-guide  — Hebrew setup instructions
 * POST /api/onboarding/verify-whatsapp — verify Meta credentials
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { query, queryOne } from '../../database/connection.js';
import logger from '../../utils/logger.js';
import type { OnboardingStatus } from '../../services/settings.service.js';
import config from '../../config/index.js';

// ============================================================================
// Constants
// ============================================================================

const VALID_STEPS: OnboardingStatus['step'][] = [
  'created',
  'template_chosen',
  'wizard_completed',
  'whatsapp_connected',
  'bot_tested',
  'live',
];

const STEP_ORDER: Record<OnboardingStatus['step'], number> = {
  created: 0,
  template_chosen: 1,
  wizard_completed: 2,
  whatsapp_connected: 3,
  bot_tested: 4,
  live: 5,
};

// ============================================================================
// Helpers
// ============================================================================

function getAccountId(req: AuthenticatedRequest): string | null {
  return req.user?.accountId ?? null;
}

function sanitizeString(input: unknown, maxLength = 200): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[<>]/g, '').trim().slice(0, maxLength);
}

// ============================================================================
// GET /api/onboarding/status
// ============================================================================

export async function getStatus(req: AuthenticatedRequest, res: Response) {
  const accountId = getAccountId(req);
  if (!accountId) {
    return res.status(401).json({ error: 'Account ID required' });
  }

  const row = await queryOne<{ onboarding_status: OnboardingStatus | null }>(
    `SELECT onboarding_status FROM settings WHERE account_id = $1`,
    [accountId],
  );

  const status: OnboardingStatus = row?.onboarding_status ?? { step: 'created' };

  logger.info(`[ONBOARD] trace=${req.headers['x-request-id'] ?? '-'} account_id=${accountId} step=${status.step}`);

  return res.json({ onboarding: status });
}

// ============================================================================
// POST /api/onboarding/complete-step
// ============================================================================

export async function completeStep(req: AuthenticatedRequest, res: Response) {
  const accountId = getAccountId(req);
  if (!accountId) {
    return res.status(401).json({ error: 'Account ID required' });
  }

  const { step } = req.body as { step?: string };

  if (!step || !VALID_STEPS.includes(step as OnboardingStatus['step'])) {
    return res.status(400).json({ error: `Invalid step. Valid: ${VALID_STEPS.join(', ')}` });
  }

  const targetStep = step as OnboardingStatus['step'];

  // Load current status
  const row = await queryOne<{ onboarding_status: OnboardingStatus | null }>(
    `SELECT onboarding_status FROM settings WHERE account_id = $1`,
    [accountId],
  );

  const current: OnboardingStatus = row?.onboarding_status ?? { step: 'created' };
  const currentOrder = STEP_ORDER[current.step];
  const targetOrder = STEP_ORDER[targetStep];

  // Cannot skip steps (but can go to current+1 or re-complete current step)
  if (targetOrder > currentOrder + 1) {
    return res.status(400).json({
      error: `Cannot skip steps. Current: ${current.step}, requested: ${targetStep}`,
    });
  }

  // Build updated status
  const now = new Date().toISOString();
  const updated: OnboardingStatus = { ...current, step: targetStep };

  if (targetStep === 'wizard_completed') updated.wizardCompletedAt = now;
  if (targetStep === 'whatsapp_connected') updated.whatsappConnectedAt = now;
  if (targetStep === 'bot_tested') updated.firstTestAt = now;
  if (targetStep === 'live') updated.wentLiveAt = now;

  await query(
    `UPDATE settings SET onboarding_status = $1::jsonb, updated_at = NOW() WHERE account_id = $2`,
    [JSON.stringify(updated), accountId],
  );

  logger.info(`[ONBOARD] trace=${req.headers['x-request-id'] ?? '-'} account_id=${accountId} step=${targetStep}`);

  return res.json({ success: true, onboarding: updated });
}

// ============================================================================
// GET /api/onboarding/whatsapp-guide
// ============================================================================

export async function getWhatsAppGuide(req: AuthenticatedRequest, res: Response) {
  const accountId = getAccountId(req);
  if (!accountId) {
    return res.status(401).json({ error: 'Account ID required' });
  }

  const port = config.server.port;
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${port}`;

  const webhookUrl = `${baseUrl}/webhook/whatsapp`;

  return res.json({
    steps: [
      {
        number: 1,
        title: 'יצירת חשבון Meta Business',
        description: 'גשו ל-business.facebook.com וצרו חשבון עסקי. לאחר מכן, הפעילו את WhatsApp Business Platform בהגדרות.',
      },
      {
        number: 2,
        title: 'הפעלת WhatsApp Business API',
        description: 'בלוח הבקרה של Meta Business, לכו ל-WhatsApp > Getting Started ועקבו אחר ההוראות להפעלת ה-API.',
      },
      {
        number: 3,
        title: 'הגדרת Webhook URL',
        description: `הזינו את ה-URL הבא בהגדרות ה-Webhook שלכם ב-Meta:`,
        webhookUrl,
      },
      {
        number: 4,
        title: 'הגדרת Verify Token',
        description: 'הזינו את ה-Verify Token שקיבלתם מהמערכת. ודאו שהוא תואם את ההגדרה בסביבה שלכם.',
      },
      {
        number: 5,
        title: 'שליחת הודעת בדיקה',
        description: 'שלחו הודעת בדיקה ממספר הטלפון שהגדרתם כדי לוודא שהחיבור פועל. ההודעה אמורה להופיע בלוח הבקרה.',
      },
    ],
  });
}

// ============================================================================
// POST /api/onboarding/verify-whatsapp
// ============================================================================

export async function verifyWhatsApp(req: AuthenticatedRequest, res: Response) {
  const accountId = getAccountId(req);
  if (!accountId) {
    return res.status(401).json({ error: 'Account ID required' });
  }

  const { phoneNumberId, accessToken } = req.body as {
    phoneNumberId?: string;
    accessToken?: string;
  };

  const cleanPhoneId = sanitizeString(phoneNumberId, 50);
  const cleanToken = sanitizeString(accessToken, 500);

  if (!cleanPhoneId || !cleanToken) {
    return res.status(400).json({ error: 'phoneNumberId and accessToken are required' });
  }

  try {
    // Verify with Meta Graph API
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${cleanPhoneId}`,
      { headers: { Authorization: `Bearer ${cleanToken}` } },
    );

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({})) as Record<string, unknown>;
      logger.warn(`[ONBOARD_ERR] trace=${req.headers['x-request-id'] ?? '-'} account_id=${accountId} step=verify_whatsapp error=invalid_token status=${response.status}`);
      return res.status(400).json({
        error: 'לא הצלחנו לאמת את פרטי ה-WhatsApp. ודאו שה-Phone Number ID וה-Access Token נכונים.',
        detail: (errBody as Record<string, unknown>).error ?? response.statusText,
      });
    }

    // Store phone number ID in settings (token stored as obfuscated reference)
    // SECURITY: We store the phone number ID and a masked token reference.
    // The full access token should be stored in environment variables, not in DB.
    const maskedToken = cleanToken.slice(0, 8) + '...' + cleanToken.slice(-4);

    await query(
      `UPDATE settings
       SET profile = COALESCE(profile, '{}'::jsonb) || $1::jsonb,
           onboarding_status = COALESCE(onboarding_status, '{}'::jsonb) || '{"step":"whatsapp_connected"}'::jsonb,
           updated_at = NOW()
       WHERE account_id = $2`,
      [
        JSON.stringify({
          whatsapp_phone_number_id: cleanPhoneId,
          whatsapp_token_ref: maskedToken,
        }),
        accountId,
      ],
    );

    logger.info(`[ONBOARD] trace=${req.headers['x-request-id'] ?? '-'} account_id=${accountId} step=whatsapp_connected phone_number_id=${cleanPhoneId}`);

    return res.json({
      success: true,
      phoneNumberId: cleanPhoneId,
      message: 'WhatsApp verified successfully',
    });

  } catch (error) {
    logger.error(`[ONBOARD_ERR] trace=${req.headers['x-request-id'] ?? '-'} account_id=${accountId} step=verify_whatsapp error=${(error as Error).message}`);
    return res.status(500).json({ error: 'Failed to verify WhatsApp credentials' });
  }
}
