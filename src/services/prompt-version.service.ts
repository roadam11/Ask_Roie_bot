/**
 * Prompt Version Service
 *
 * Manages prompt versions: save, list, activate, rollback.
 * Uses existing prompt_versions table (migration 005).
 * wizard_answers stored in wizard_answers JSONB column (migration 018).
 */

import { query, queryOne, transaction } from '../database/connection.js';
import logger from '../utils/logger.js';
import type { WizardAnswers } from '../prompts/industry-templates.js';

// ============================================================================
// Types
// ============================================================================

export interface PromptVersion {
  id: string;
  account_id: string;
  version_number: number;
  version_name: string;
  description: string | null;
  system_prompt: string;
  wizard_answers: WizardAnswers | null;
  template_id: string | null;
  active: boolean;
  created_at: string;
  created_by: string | null;
}

// ============================================================================
// Version Management
// ============================================================================

/**
 * Save a new prompt version and activate it.
 * Auto-increments version_number per account.
 * Deactivates any currently active version first.
 */
export async function savePromptVersion(
  accountId: string,
  wizardAnswers: WizardAnswers,
  generatedPrompt: string,
  templateId?: string,
  createdBy?: string,
): Promise<{ versionId: string; versionNumber: number }> {
  return transaction(async (client) => {
    // Get next version number
    const maxResult = await client.query(
      'SELECT COALESCE(MAX(version_number), 0) + 1 as next_version FROM prompt_versions WHERE account_id = $1',
      [accountId],
    );
    const nextVersion = maxResult.rows[0].next_version as number;

    // Deactivate current active version
    await client.query(
      `UPDATE prompt_versions SET active = false, deactivated_at = NOW()
       WHERE account_id = $1 AND active = true`,
      [accountId],
    );

    // Insert new version as active
    const insertResult = await client.query(
      `INSERT INTO prompt_versions
        (account_id, version_number, version_name, description, system_prompt, wizard_answers, template_id, active, activated_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), $8)
       RETURNING id`,
      [
        accountId,
        nextVersion,
        `v${nextVersion}`,
        templateId ? `Generated from template: ${templateId}` : 'Generated from wizard',
        generatedPrompt,
        JSON.stringify(wizardAnswers),
        templateId || null,
        createdBy || null,
      ],
    );

    const versionId = insertResult.rows[0].id as string;

    logger.info(`[PROMPT_SAVE] account_id=${accountId} version=${nextVersion} template=${templateId || 'custom'}`);

    return { versionId, versionNumber: nextVersion };
  });
}

/**
 * Get the active prompt version for an account.
 */
export async function getActiveVersion(accountId: string): Promise<PromptVersion | null> {
  return queryOne<PromptVersion>(
    `SELECT id, account_id, version_number, version_name, description,
            system_prompt, wizard_answers, template_id, active, created_at, created_by
     FROM prompt_versions
     WHERE account_id = $1 AND active = true
     LIMIT 1`,
    [accountId],
  );
}

/**
 * List all prompt versions for an account, newest first.
 */
export async function listVersions(accountId: string): Promise<PromptVersion[]> {
  const result = await query<PromptVersion>(
    `SELECT id, account_id, version_number, version_name, description,
            system_prompt, wizard_answers, template_id, active, created_at, created_by
     FROM prompt_versions
     WHERE account_id = $1
     ORDER BY version_number DESC`,
    [accountId],
  );
  return result.rows;
}

/**
 * Activate a specific version (rollback). Deactivates the current active version.
 */
export async function activateVersion(
  accountId: string,
  versionId: string,
): Promise<{ versionNumber: number }> {
  return transaction(async (client) => {
    // Deactivate current
    await client.query(
      `UPDATE prompt_versions SET active = false, deactivated_at = NOW()
       WHERE account_id = $1 AND active = true`,
      [accountId],
    );

    // Activate chosen
    const result = await client.query(
      `UPDATE prompt_versions SET active = true, activated_at = NOW()
       WHERE id = $1 AND account_id = $2
       RETURNING version_number`,
      [versionId, accountId],
    );

    if (result.rows.length === 0) {
      throw new Error('Version not found or does not belong to this account');
    }

    const versionNumber = result.rows[0].version_number as number;
    logger.info(`[PROMPT_ACTIVATE] account_id=${accountId} version=${versionNumber} (rollback)`);

    return { versionNumber };
  });
}

/**
 * Get active version for a lead (via lead → agent → account path).
 * Used by the prompt assembly pipeline.
 */
export async function getActiveVersionForLead(leadId: string): Promise<PromptVersion | null> {
  return queryOne<PromptVersion>(
    `SELECT pv.id, pv.account_id, pv.version_number, pv.version_name, pv.description,
            pv.system_prompt, pv.wizard_answers, pv.template_id, pv.active, pv.created_at, pv.created_by
     FROM prompt_versions pv
     JOIN agents a ON a.account_id = pv.account_id
     JOIN leads l ON l.agent_id = a.id AND l.deleted_at IS NULL
     WHERE l.id = $1 AND pv.active = true
     LIMIT 1`,
    [leadId],
  );
}
