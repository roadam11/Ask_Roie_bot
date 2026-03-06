/**
 * Prompt Builder Routes
 *
 * Template listing (public) + wizard/versioning/sandbox (auth required).
 *
 * @routes
 * GET  /api/templates           — list industry templates (public)
 * GET  /api/templates/:id       — get template defaults (public)
 * POST /api/prompt-builder/generate  — preview prompt (auth)
 * POST /api/prompt-builder/save      — save + activate (auth)
 * POST /api/prompt-builder/test      — sandbox test (auth, rate limited)
 * GET  /api/prompt-versions          — list versions (auth)
 * POST /api/prompt-versions/:id/activate — rollback (auth)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import * as PromptBuilderController from '../controllers/prompt-builder.controller.js';

const router = Router();

// ============================================================================
// Public Routes — templates
// ============================================================================

router.get('/templates', PromptBuilderController.listTemplates);
router.get('/templates/:id', PromptBuilderController.getTemplateById);

// ============================================================================
// Auth Required — prompt builder + versions + sandbox
// ============================================================================

router.post('/prompt-builder/generate', authenticate, PromptBuilderController.generatePreview);
router.post('/prompt-builder/save', authenticate, PromptBuilderController.savePrompt);
router.post('/prompt-builder/test', authenticate, PromptBuilderController.testPrompt);

router.get('/prompt-versions', authenticate, PromptBuilderController.listVersions);
router.post('/prompt-versions/:id/activate', authenticate, PromptBuilderController.activateVersionEndpoint);

export default router;
