/**
 * Onboarding Routes
 *
 * All endpoints require authentication. account_id from auth context.
 *
 * @routes
 * GET  /api/onboarding/status           — current onboarding step
 * POST /api/onboarding/complete-step    — advance to next step
 * GET  /api/onboarding/whatsapp-guide   — Hebrew setup instructions
 * POST /api/onboarding/verify-whatsapp  — verify Meta credentials
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import * as OnboardingController from '../controllers/onboarding.controller.js';

const router = Router();

router.use(authenticate);

router.get('/onboarding/status', OnboardingController.getStatus);
router.post('/onboarding/complete-step', OnboardingController.completeStep);
router.get('/onboarding/whatsapp-guide', OnboardingController.getWhatsAppGuide);
router.post('/onboarding/verify-whatsapp', OnboardingController.verifyWhatsApp);

export default router;
