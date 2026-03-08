-- Migration 020: Add lead_profile JSONB column for structured lead data
-- Sprint 5.6 — Lead Profile Engine

ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_profile JSONB DEFAULT '{}';
