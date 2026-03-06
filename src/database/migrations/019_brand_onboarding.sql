-- Migration 019: Brand settings + onboarding status
-- Supports multi-tenant rebranding and guided onboarding flow.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS brand JSONB DEFAULT '{}';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS onboarding_status JSONB DEFAULT '{"step": "created"}';
