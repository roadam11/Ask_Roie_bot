-- ============================================================================
-- 013_activation_engine.sql
-- Sprint 4.3 — Activation Engine
-- Adds is_demo flag to leads + seeds activation_status in settings profile
-- ============================================================================

-- Step 1: is_demo column on leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_leads_is_demo ON leads(is_demo) WHERE is_demo = true;

-- Step 2: Seed activation_status in settings profile (monotonic: none → demo → real_lead)
UPDATE settings
SET profile = COALESCE(profile, '{}'::jsonb) || '{"activation_status":"none"}'::jsonb
WHERE profile->>'activation_status' IS NULL;
