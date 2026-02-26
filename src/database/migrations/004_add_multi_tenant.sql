-- Ask ROIE Bot - Multi-Tenant Architecture
-- Migration: 004_add_multi_tenant.sql
-- Created: 2026-02-25
-- Description: Adds multi-tenant support with accounts and agents

-- ============================================================================
-- ACCOUNTS TABLE
-- Stores tenant/organization information
-- ============================================================================

CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) UNIQUE,
    plan VARCHAR(20) DEFAULT 'free' NOT NULL,
    status VARCHAR(20) DEFAULT 'active' NOT NULL,
    owner_email VARCHAR(255),
    billing_email VARCHAR(255),
    settings JSONB DEFAULT '{}' NOT NULL,
    limits JSONB DEFAULT '{"max_agents": 1, "max_leads_per_month": 100, "max_followups_per_lead": 3}' NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Constraints
    CONSTRAINT chk_accounts_plan CHECK (
        plan IN ('free', 'starter', 'professional', 'enterprise')
    ),
    CONSTRAINT chk_accounts_status CHECK (
        status IN ('active', 'suspended', 'cancelled', 'trial')
    )
);

-- ============================================================================
-- AGENTS TABLE
-- Stores bot/agent instances per account (WhatsApp, Telegram, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    platform VARCHAR(20) NOT NULL,
    phone VARCHAR(20),
    telegram_bot_token VARCHAR(100),
    active BOOLEAN DEFAULT true NOT NULL,
    settings JSONB DEFAULT '{}' NOT NULL,
    webhook_secret VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Constraints
    CONSTRAINT chk_agents_platform CHECK (
        platform IN ('whatsapp', 'telegram', 'instagram', 'messenger', 'web')
    ),
    -- Unique phone per platform
    CONSTRAINT uq_agents_platform_phone UNIQUE (platform, phone)
);

-- ============================================================================
-- UPDATE LEADS TABLE
-- Add agent reference and additional tracking fields
-- ============================================================================

-- Add agent_id column (nullable for backwards compatibility)
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;

-- Add lost_reason for better analytics
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS lost_reason VARCHAR(100);

-- Add lead_value for revenue tracking
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS lead_value DECIMAL(10,2);

-- Add constraint for lost_reason
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_leads_lost_reason'
    ) THEN
        ALTER TABLE leads
        ADD CONSTRAINT chk_leads_lost_reason CHECK (
            lost_reason IS NULL OR lost_reason IN (
                'price_too_high',
                'found_alternative',
                'not_interested',
                'no_response',
                'wrong_timing',
                'location_issue',
                'format_mismatch',
                'other'
            )
        );
    END IF;
END $$;

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Accounts indexes
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_plan ON accounts(plan);
CREATE INDEX IF NOT EXISTS idx_accounts_slug ON accounts(slug);

-- Agents indexes
CREATE INDEX IF NOT EXISTS idx_agents_account_id ON agents(account_id);
CREATE INDEX IF NOT EXISTS idx_agents_platform ON agents(platform);
CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(active);
CREATE INDEX IF NOT EXISTS idx_agents_phone ON agents(phone);

-- Leads agent index
CREATE INDEX IF NOT EXISTS idx_leads_agent_id ON leads(agent_id);
CREATE INDEX IF NOT EXISTS idx_leads_lost_reason ON leads(lost_reason) WHERE lost_reason IS NOT NULL;

-- ============================================================================
-- DEFAULT ACCOUNT & AGENT (for existing data)
-- ============================================================================

-- Create default account for existing leads
INSERT INTO accounts (id, name, slug, plan, status, settings)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Ask ROIE',
    'ask-roie',
    'professional',
    'active',
    '{"timezone": "Asia/Jerusalem", "language": "he"}'
)
ON CONFLICT (slug) DO NOTHING;

-- Create default WhatsApp agent
INSERT INTO agents (id, account_id, name, platform, active, settings)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Ask ROIE WhatsApp',
    'whatsapp',
    true,
    '{"greeting_enabled": true}'
)
ON CONFLICT DO NOTHING;

-- Create default Telegram agent
INSERT INTO agents (id, account_id, name, platform, active, settings)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'Ask ROIE Telegram',
    'telegram',
    true,
    '{"greeting_enabled": true}'
)
ON CONFLICT DO NOTHING;

-- Update existing leads to use default agent (WhatsApp)
UPDATE leads
SET agent_id = '00000000-0000-0000-0000-000000000001'
WHERE agent_id IS NULL;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE accounts IS 'Multi-tenant accounts/organizations';
COMMENT ON TABLE agents IS 'Bot agents per account (WhatsApp, Telegram, etc.)';
COMMENT ON COLUMN leads.agent_id IS 'Reference to the agent that owns this lead';
COMMENT ON COLUMN leads.lost_reason IS 'Reason for marking lead as lost';
COMMENT ON COLUMN leads.lead_value IS 'Estimated or actual revenue value of lead';
