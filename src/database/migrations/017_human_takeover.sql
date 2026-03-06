-- Migration 017: Human takeover support
-- Adds columns to conversations table for admin takeover of AI conversations.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_active BOOLEAN DEFAULT true;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS taken_over_by TEXT DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS taken_over_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_ai_active
  ON conversations(ai_active) WHERE ai_active = false;
