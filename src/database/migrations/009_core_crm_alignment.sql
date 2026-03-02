-- Ask ROIE Bot - Core CRM Alignment
-- Migration: 009_core_crm_alignment.sql
-- Created: 2026-03-02
-- Description: Aligns backend schema with admin dashboard frontend DTO contracts.
--              Adds conversation CRM fields, message conversation linkage,
--              settings table, and knowledge documents table.

-- ============================================================================
-- CONVERSATIONS TABLE — CRM fields for admin dashboard
-- ============================================================================

-- Channel the conversation happened on
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel VARCHAR(20) DEFAULT 'whatsapp';

-- AI stage (dashboard-facing, separate from internal outcome)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_stage VARCHAR(30) DEFAULT 'qualifying';

-- Unread message count (dashboard notification badge)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0;

-- Denormalized last message text (avoids subquery on every list load)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message TEXT;

-- Denormalized last message timestamp
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP;

-- Constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversations_channel') THEN
        ALTER TABLE conversations ADD CONSTRAINT chk_conversations_channel
            CHECK (channel IS NULL OR channel IN ('whatsapp', 'telegram', 'web'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversations_ai_stage') THEN
        ALTER TABLE conversations ADD CONSTRAINT chk_conversations_ai_stage
            CHECK (ai_stage IS NULL OR ai_stage IN ('qualifying', 'negotiating', 'booked', 'lost'));
    END IF;
END $$;

-- ============================================================================
-- MESSAGES TABLE — Link messages to conversations
-- ============================================================================

-- Optional FK to conversations (NULL for legacy messages not yet linked)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_id UUID;

-- FK constraint (soft — allows NULL for backwards compat)
ALTER TABLE messages DROP CONSTRAINT IF EXISTS fk_messages_conversation;
ALTER TABLE messages
    ADD CONSTRAINT fk_messages_conversation
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;

-- ============================================================================
-- SETTINGS TABLE — Per-account CRM settings (profile + AI behavior)
-- ============================================================================

CREATE TABLE IF NOT EXISTS settings (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id   UUID NOT NULL,
    profile      JSONB NOT NULL DEFAULT '{}',
    behavior     JSONB NOT NULL DEFAULT '{}',
    last_saved_at TIMESTAMP DEFAULT NOW() NOT NULL,
    created_at   TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at   TIMESTAMP DEFAULT NOW() NOT NULL,

    CONSTRAINT uq_settings_account UNIQUE (account_id)
);

ALTER TABLE settings DROP CONSTRAINT IF EXISTS fk_settings_account;
ALTER TABLE settings
    ADD CONSTRAINT fk_settings_account
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

-- ============================================================================
-- KNOWLEDGE_DOCUMENTS TABLE — Per-account knowledge base files
-- ============================================================================

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID NOT NULL,
    name        VARCHAR(255) NOT NULL,
    type        VARCHAR(10) NOT NULL,
    size_bytes  BIGINT NOT NULL DEFAULT 0,
    file_path   TEXT,
    status      VARCHAR(20) NOT NULL DEFAULT 'processing',
    uploaded_at TIMESTAMP DEFAULT NOW() NOT NULL,
    created_at  TIMESTAMP DEFAULT NOW() NOT NULL,

    CONSTRAINT chk_knowledge_type   CHECK (type   IN ('pdf', 'docx', 'txt')),
    CONSTRAINT chk_knowledge_status CHECK (status IN ('ready', 'processing', 'error'))
);

ALTER TABLE knowledge_documents DROP CONSTRAINT IF EXISTS fk_knowledge_documents_account;
ALTER TABLE knowledge_documents
    ADD CONSTRAINT fk_knowledge_documents_account
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

-- ============================================================================
-- DATA MIGRATION — Link existing messages to conversations
-- ============================================================================

-- Assign existing messages to conversations by lead_id + time range
UPDATE messages m
SET conversation_id = (
    SELECT c.id
    FROM conversations c
    WHERE c.lead_id = m.lead_id
      AND m.created_at >= c.started_at
      AND (c.ended_at IS NULL OR m.created_at <= c.ended_at)
    ORDER BY c.started_at DESC
    LIMIT 1
)
WHERE m.conversation_id IS NULL;

-- Populate last_message / last_message_at from existing messages
UPDATE conversations c
SET
    last_message    = (
        SELECT content FROM messages m
        WHERE m.lead_id = c.lead_id
        ORDER BY m.created_at DESC
        LIMIT 1
    ),
    last_message_at = (
        SELECT created_at FROM messages m
        WHERE m.lead_id = c.lead_id
        ORDER BY created_at DESC
        LIMIT 1
    )
WHERE last_message IS NULL;

-- Set channel from agent platform
UPDATE conversations c
SET channel = (
    SELECT a.platform
    FROM agents a
    WHERE a.id = (
        SELECT agent_id FROM leads l WHERE l.id = c.lead_id
    )
    LIMIT 1
)
WHERE channel = 'whatsapp' OR channel IS NULL;

-- Set ai_stage from lead status
UPDATE conversations c
SET ai_stage = (
    SELECT CASE l.status
        WHEN 'booked' THEN 'booked'
        WHEN 'lost'   THEN 'lost'
        WHEN 'ready_to_book' THEN 'negotiating'
        ELSE 'qualifying'
    END
    FROM leads l WHERE l.id = c.lead_id
)
WHERE ai_stage = 'qualifying' OR ai_stage IS NULL;

-- ============================================================================
-- DEFAULT SETTINGS for the default account
-- ============================================================================

INSERT INTO settings (account_id, profile, behavior, last_saved_at)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    jsonb_build_object(
        'id',          '00000000-0000-0000-0000-000000000001',
        'companyName', 'Ask ROIE',
        'ownerName',   'ROIE',
        'email',       'admin@askroie.com',
        'phone',       '+972-50-000-0000',
        'timezone',    'Asia/Jerusalem'
    ),
    jsonb_build_object(
        'tone',         'friendly',
        'strictness',   60,
        'systemPrompt', 'You are an AI sales agent for Ask ROIE tutoring service. Help qualify leads and guide them toward booking a trial lesson.'
    ),
    NOW()
)
ON CONFLICT (account_id) DO NOTHING;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_conversations_channel
    ON conversations(channel);

CREATE INDEX IF NOT EXISTS idx_conversations_ai_stage
    ON conversations(ai_stage);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at
    ON conversations(last_message_at);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
    ON messages(conversation_id)
    WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_account_id
    ON knowledge_documents(account_id);

CREATE INDEX IF NOT EXISTS idx_settings_account_id
    ON settings(account_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_settings_updated_at ON settings;
CREATE TRIGGER update_settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE settings IS 'Per-account AI and profile settings for admin dashboard';
COMMENT ON TABLE knowledge_documents IS 'Knowledge base documents per account, referenced by AI';
COMMENT ON COLUMN conversations.channel IS 'Communication channel: whatsapp, telegram, web';
COMMENT ON COLUMN conversations.ai_stage IS 'AI sales stage: qualifying, negotiating, booked, lost';
COMMENT ON COLUMN conversations.unread_count IS 'Number of unread messages for dashboard badge';
COMMENT ON COLUMN conversations.last_message IS 'Denormalized last message text for list performance';
COMMENT ON COLUMN conversations.last_message_at IS 'Denormalized last message timestamp for sorting';
COMMENT ON COLUMN messages.conversation_id IS 'Optional FK to conversations — NULL for legacy messages';
