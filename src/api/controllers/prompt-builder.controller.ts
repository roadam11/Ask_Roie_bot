/**
 * Prompt Builder Controller
 *
 * Handles template listing, prompt generation, saving,
 * versioning, and sandbox testing.
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { TEMPLATES, getTemplate, getBlankAnswers } from '../../prompts/industry-templates.js';
import type { WizardAnswers } from '../../prompts/industry-templates.js';
import { generatePromptFromWizard } from '../../prompts/prompt-generator.js';
import * as PromptVersionService from '../../services/prompt-version.service.js';
import * as ClaudeService from '../../services/claude.service.js';
import { buildPromptWithContext } from '../../prompts/system-prompt.js';
import logger from '../../utils/logger.js';

// ============================================================================
// Sandbox Rate Limiter (in-memory)
// ============================================================================

const testCallCounts = new Map<string, { count: number; resetAt: number }>();
const MAX_TEST_CALLS_PER_HOUR = 5;

function checkSandboxRateLimit(accountId: string): boolean {
  const now = Date.now();
  const entry = testCallCounts.get(accountId);

  if (!entry || now > entry.resetAt) {
    testCallCounts.set(accountId, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }

  if (entry.count >= MAX_TEST_CALLS_PER_HOUR) {
    return false;
  }

  entry.count++;
  return true;
}

// ============================================================================
// Template Endpoints (public)
// ============================================================================

/**
 * GET /api/templates — list all industry templates
 */
export function listTemplates(_req: AuthenticatedRequest, res: Response) {
  const summaries = TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    icon: t.icon,
    description: t.description,
  }));
  return res.json({ templates: summaries });
}

/**
 * GET /api/templates/:id — get specific template with defaults
 */
export function getTemplateById(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;

  if (id === 'blank') {
    return res.json({ template: null, defaults: getBlankAnswers() });
  }

  const template = getTemplate(id);
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  return res.json({ template: { id: template.id, name: template.name, icon: template.icon, description: template.description }, defaults: template.defaults });
}

// ============================================================================
// Prompt Builder Endpoints (auth required)
// ============================================================================

/**
 * POST /api/prompt-builder/generate — preview without saving
 */
export function generatePreview(req: AuthenticatedRequest, res: Response) {
  const { wizardAnswers, templateId } = req.body as {
    wizardAnswers: WizardAnswers;
    templateId?: string;
  };

  if (!wizardAnswers) {
    return res.status(400).json({ error: 'wizardAnswers required' });
  }

  const result = generatePromptFromWizard(wizardAnswers);

  logger.info(`[PROMPT_GEN] account_id=${req.user?.accountId} template=${templateId || 'custom'}`);

  return res.json({
    preview: result.fullPrompt,
    hardConstraints: result.hardConstraints,
    salesPrompt: result.salesPrompt,
    businessProfile: result.businessProfile,
  });
}

/**
 * POST /api/prompt-builder/save — generate + save + activate
 */
export async function savePrompt(req: AuthenticatedRequest, res: Response) {
  const accountId = req.user?.accountId;
  if (!accountId) {
    return res.status(401).json({ error: 'Account ID required' });
  }

  const { wizardAnswers, templateId } = req.body as {
    wizardAnswers: WizardAnswers;
    templateId?: string;
  };

  if (!wizardAnswers) {
    return res.status(400).json({ error: 'wizardAnswers required' });
  }

  const result = generatePromptFromWizard(wizardAnswers);

  const { versionId, versionNumber } = await PromptVersionService.savePromptVersion(
    accountId,
    wizardAnswers,
    result.fullPrompt,
    templateId,
    req.user?.id,
  );

  return res.json({
    success: true,
    versionId,
    versionNumber,
    isActive: true,
  });
}

/**
 * POST /api/prompt-builder/test — sandbox test (rate limited)
 */
export async function testPrompt(req: AuthenticatedRequest, res: Response) {
  const accountId = req.user?.accountId;
  if (!accountId) {
    return res.status(401).json({ error: 'Account ID required' });
  }

  // Rate limit check
  if (!checkSandboxRateLimit(accountId)) {
    logger.warn(`[SANDBOX_LIMIT] account_id=${accountId} blocked=true`);
    return res.status(429).json({ error: 'Rate limit exceeded. Max 5 test calls per hour.' });
  }

  const { wizardAnswers, testMessage } = req.body as {
    wizardAnswers: WizardAnswers;
    testMessage: string;
  };

  if (!wizardAnswers || !testMessage?.trim()) {
    return res.status(400).json({ error: 'wizardAnswers and testMessage required' });
  }

  // Generate prompt from wizard
  const generated = generatePromptFromWizard(wizardAnswers);

  // Build full system prompt with mock lead state
  const systemPrompt = buildPromptWithContext(
    [{ role: 'user', content: testMessage }],
    null, // no lead state
    null, // no settings
    generated.fullPrompt,
  );

  try {
    // Use sendSimpleMessage — no tools, no DB save, no WhatsApp
    const response = await ClaudeService.sendSimpleMessage(systemPrompt, testMessage);

    logger.info(`[SANDBOX_TEST] account_id=${accountId} template=${wizardAnswers.businessType || 'custom'} response_length=${response.length}`);

    return res.json({
      response,
      model: 'default',
    });
  } catch (error) {
    logger.error('[SANDBOX_TEST] AI call failed', {
      accountId,
      error: (error as Error).message,
    });
    return res.status(500).json({ error: 'AI call failed' });
  }
}

// ============================================================================
// Version Endpoints (auth required)
// ============================================================================

/**
 * GET /api/prompt-versions — list all versions for account
 */
export async function listVersions(req: AuthenticatedRequest, res: Response) {
  const accountId = req.user?.accountId;
  if (!accountId) {
    return res.status(401).json({ error: 'Account ID required' });
  }

  const versions = await PromptVersionService.listVersions(accountId);

  return res.json({
    versions: versions.map((v) => ({
      id: v.id,
      versionNumber: v.version_number,
      versionName: v.version_name,
      description: v.description,
      templateId: v.template_id,
      active: v.active,
      createdAt: v.created_at,
      createdBy: v.created_by,
      hasWizardAnswers: !!v.wizard_answers,
    })),
  });
}

/**
 * POST /api/prompt-versions/:id/activate — rollback to specific version
 */
export async function activateVersionEndpoint(req: AuthenticatedRequest, res: Response) {
  const accountId = req.user?.accountId;
  if (!accountId) {
    return res.status(401).json({ error: 'Account ID required' });
  }

  const { id } = req.params;

  try {
    const result = await PromptVersionService.activateVersion(accountId, id);
    return res.json({
      success: true,
      versionNumber: result.versionNumber,
    });
  } catch (error) {
    return res.status(404).json({ error: (error as Error).message });
  }
}
