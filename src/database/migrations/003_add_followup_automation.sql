-- Ask ROIE Bot - Follow-up Automation Enhancement
-- Migration: 003_add_followup_automation.sql
-- Created: 2026-02-24
-- Description: Adds production-grade follow-up automation with state machine,
--              priority system, human override, and smart scheduling
--
-- ARCHITECTURE NOTES:
-- - lead_state is SEPARATE from status (not duplication!)
--   * status = sales pipeline stage (qualified, considering, booked)
--   * lead_state = automation state machine (engaged, thinking, trial_scheduled)
--
-- - followups table is kept for legacy/analytics but NOT used for new automation
--   * New automation uses BullMQ delayed jobs with deterministic IDs
--   * followups table still useful for historical reporting
--
-- TODO Phase 2: Consider consolidating tables when legacy follow-ups are phased out
-- TODO Phase 2: Add follow_up_history JSONB column to leads for audit trail

-- ============================================================================
-- LEADS TABLE ENHANCEMENTS
-- New columns for follow-up automation state machine
-- ============================================================================

-- Lead state machine (6 states for follow-up decisions)
-- Separate from 'status' which is the sales pipeline stage
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_state VARCHAR(50) DEFAULT 'new';

-- Follow-up scheduling fields
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_scheduled_at TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_type VARCHAR(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_count INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_priority INTEGER DEFAULT 50;

-- Trial lesson tracking
ALTER TABLE leads ADD COLUMN IF NOT EXISTS trial_scheduled_at TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS trial_completed_at TIMESTAMP;

-- Human override tracking
ALTER TABLE leads ADD COLUMN IF NOT EXISTS human_contacted_at TIMESTAMP;

-- ============================================================================
-- CONSTRAINTS
-- Enforce business rules at database level
-- ============================================================================

-- Lead state must be one of the 6 valid states
ALTER TABLE leads DROP CONSTRAINT IF EXISTS chk_leads_lead_state;
ALTER TABLE leads ADD CONSTRAINT chk_leads_lead_state CHECK (
    lead_state IS NULL OR lead_state IN (
        'new',              -- First contact, no conversation yet
        'engaged',          -- Active conversation in progress
        'thinking',         -- User said "אחשוב על זה" or similar
        'trial_scheduled',  -- Trial lesson booked
        'converted',        -- Became paying student
        'closed'            -- Not relevant / opted out
    )
);

-- Follow-up type must be valid
ALTER TABLE leads DROP CONSTRAINT IF EXISTS chk_leads_follow_up_type;
ALTER TABLE leads ADD CONSTRAINT chk_leads_follow_up_type CHECK (
    follow_up_type IS NULL OR follow_up_type IN (
        'thinking_24h',        -- 24h after "אחשוב"
        'trial_reminder_2h',   -- 2h before trial
        'trial_followup_24h',  -- 24h after trial
        'idle_48h'             -- 48h no response
    )
);

-- Maximum 3 follow-ups per lead (spam prevention)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS chk_leads_follow_up_count;
ALTER TABLE leads ADD CONSTRAINT chk_leads_follow_up_count CHECK (
    follow_up_count >= 0 AND follow_up_count <= 3
);

-- Priority must be in valid range (0-100)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS chk_leads_follow_up_priority;
ALTER TABLE leads ADD CONSTRAINT chk_leads_follow_up_priority CHECK (
    follow_up_priority >= 0 AND follow_up_priority <= 100
);

-- ============================================================================
-- FOLLOWUPS TABLE ENHANCEMENTS
-- Update type constraint to support new follow-up types
-- ============================================================================

-- Drop old constraint and add new one with expanded types
ALTER TABLE followups DROP CONSTRAINT IF EXISTS chk_followups_type;
ALTER TABLE followups ADD CONSTRAINT chk_followups_type CHECK (
    type IN (
        -- Legacy types (kept for backward compatibility)
        '24h', '72h', '7d',
        -- New automation types
        'thinking_24h',
        'trial_reminder_2h',
        'trial_followup_24h',
        'idle_48h'
    )
);

-- Add priority column to followups table
ALTER TABLE followups ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 50;

-- Add job_id column for BullMQ job tracking (enables cancellation)
ALTER TABLE followups ADD COLUMN IF NOT EXISTS job_id VARCHAR(100);

-- ============================================================================
-- INDEXES
-- Performance optimization for follow-up queries
-- ============================================================================

-- Index for finding leads with scheduled follow-ups (sorted by time)
CREATE INDEX IF NOT EXISTS idx_leads_follow_up_scheduled
    ON leads(follow_up_scheduled_at)
    WHERE follow_up_scheduled_at IS NOT NULL;

-- Index for lead state queries
CREATE INDEX IF NOT EXISTS idx_leads_lead_state
    ON leads(lead_state);

-- Index for human override check (recent contacts)
CREATE INDEX IF NOT EXISTS idx_leads_human_contacted
    ON leads(human_contacted_at)
    WHERE human_contacted_at IS NOT NULL;

-- Index for trial scheduling queries
CREATE INDEX IF NOT EXISTS idx_leads_trial_scheduled
    ON leads(trial_scheduled_at)
    WHERE trial_scheduled_at IS NOT NULL;

-- Index for idle lead detection (last user message + state)
CREATE INDEX IF NOT EXISTS idx_leads_idle_detection
    ON leads(last_user_message_at, lead_state)
    WHERE last_user_message_at IS NOT NULL;

-- Index for followups job_id (for cancellation lookup)
CREATE INDEX IF NOT EXISTS idx_followups_job_id
    ON followups(job_id)
    WHERE job_id IS NOT NULL;

-- Composite index for priority-based follow-up selection
CREATE INDEX IF NOT EXISTS idx_followups_priority_scheduled
    ON followups(priority DESC, scheduled_for ASC)
    WHERE status = 'pending';

-- ============================================================================
-- COMMENTS
-- Documentation for new columns
-- ============================================================================

COMMENT ON COLUMN leads.lead_state IS 'State machine for follow-up automation: new, engaged, thinking, trial_scheduled, converted, closed';
COMMENT ON COLUMN leads.follow_up_scheduled_at IS 'When the next follow-up is scheduled to be sent';
COMMENT ON COLUMN leads.follow_up_type IS 'Type of scheduled follow-up: thinking_24h, trial_reminder_2h, trial_followup_24h, idle_48h';
COMMENT ON COLUMN leads.follow_up_count IS 'Number of follow-ups sent to this lead (max 3)';
COMMENT ON COLUMN leads.follow_up_priority IS 'Priority of current follow-up (0-100, higher = more important)';
COMMENT ON COLUMN leads.trial_scheduled_at IS 'When the trial lesson is scheduled for';
COMMENT ON COLUMN leads.trial_completed_at IS 'When the trial lesson was completed';
COMMENT ON COLUMN leads.human_contacted_at IS 'When Roie last manually contacted this lead (blocks automation for 48h)';

COMMENT ON COLUMN followups.priority IS 'Follow-up priority (0-100, higher = send first)';
COMMENT ON COLUMN followups.job_id IS 'BullMQ job ID for cancellation';

-- ============================================================================
-- DATA MIGRATION
-- Set default lead_state based on existing status
-- ============================================================================

-- Initialize lead_state from existing status for existing leads
UPDATE leads SET lead_state =
    CASE
        WHEN opted_out = true THEN 'closed'
        WHEN status = 'booked' THEN 'trial_scheduled'
        WHEN status = 'lost' THEN 'closed'
        WHEN status = 'new' THEN 'new'
        ELSE 'engaged'
    END
WHERE lead_state IS NULL OR lead_state = 'new';

-- Set trial_scheduled_at from booked_at for existing booked leads
UPDATE leads SET trial_scheduled_at = booked_at
WHERE status = 'booked' AND trial_scheduled_at IS NULL AND booked_at IS NOT NULL;
