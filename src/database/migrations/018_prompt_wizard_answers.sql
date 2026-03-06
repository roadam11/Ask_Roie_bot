-- Migration 018: Add wizard_answers and template_id to prompt_versions
-- Supports the Dynamic Prompt Builder wizard flow.

ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS wizard_answers JSONB DEFAULT NULL;
ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS template_id TEXT DEFAULT NULL;
