/**
 * Account Settings Service
 *
 * Loads per-account settings (profile + AI behavior) from the settings table.
 * Used by claude.service to personalize the system prompt per tenant.
 *
 * Schema: migration 009_core_crm_alignment.sql
 */

import { queryOne } from '../database/connection.js';

// ============================================================================
// Types — match JSONB shapes stored in settings.profile / settings.behavior
// ============================================================================

export interface AccountProfile {
  companyName?: string;
  ownerName?: string;
  phone?: string;
  email?: string;
  timezone?: string;
  subjects?: string[];
  levels?: string | string[];
  experience?: string;
  credentials?: string;
  price_per_lesson?: number;
  pricing?: string;
  packages?: string;
  availability?: string;
  location?: string;
  formats?: string;
  usp?: string;
  calendly_link?: string;
}

export interface AccountBehavior {
  systemPrompt?: string;
  tone?: string;
  strictness?: number;
  responseStyle?: string;
  language?: string;
}

export interface BrandSettings {
  brandName?: string;        // Dashboard display name
  businessName?: string;     // Bot conversation name
  supportEmail?: string;     // Contact email
  logoUrl?: string;          // Future: custom logo
}

export interface OnboardingStatus {
  step: 'created' | 'template_chosen' | 'wizard_completed' | 'whatsapp_connected' | 'bot_tested' | 'live';
  templateId?: string;
  wizardCompletedAt?: string;
  whatsappConnectedAt?: string;
  firstTestAt?: string;
  wentLiveAt?: string;
}

export interface AccountSettings {
  profile: AccountProfile | null;
  behavior: AccountBehavior | null;
  brand?: BrandSettings | null;
  onboardingStatus?: OnboardingStatus | null;
}

// ============================================================================
// Settings Loader
// ============================================================================

/**
 * Load account settings for a given lead via a single JOIN query.
 *
 * Path: leads.agent_id → agents.account_id → settings.account_id
 *
 * Returns null if no settings row exists or if the lead has no agent.
 */
export async function loadSettingsForLead(leadId: string): Promise<AccountSettings | null> {
  const row = await queryOne<{ profile: unknown; behavior: unknown; brand: unknown; onboarding_status: unknown }>(
    `SELECT s.profile, s.behavior, s.brand, s.onboarding_status
     FROM settings s
     JOIN agents a ON a.account_id = s.account_id
     JOIN leads l ON l.agent_id = a.id AND l.deleted_at IS NULL
     WHERE l.id = $1
     LIMIT 1`,
    [leadId],
  );

  if (!row) {
    return null;
  }

  // JSONB columns are already parsed by pg driver, but guard against SQL NULL
  const profile = (row.profile && typeof row.profile === 'object')
    ? row.profile as AccountProfile
    : null;

  const behavior = (row.behavior && typeof row.behavior === 'object')
    ? row.behavior as AccountBehavior
    : null;

  const brand = (row.brand && typeof row.brand === 'object')
    ? row.brand as BrandSettings
    : null;

  const onboardingStatus = (row.onboarding_status && typeof row.onboarding_status === 'object')
    ? row.onboarding_status as OnboardingStatus
    : null;

  return { profile, behavior, brand, onboardingStatus };
}
