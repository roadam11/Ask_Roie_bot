-- Ask ROIE Bot - Multi-Tenant Architecture
-- Migration: 004_add_multi_tenant.sql
-- Created: 2026-02-25
-- Description: Adds multi-tenant support with accounts, agents, and admin users

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
    account_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    platform VARCHAR(20) NOT NULL,
    phone VARCHAR(20),
    telegram_bot_token VARCHAR(100),
    telegram_chat_id VARCHAR(50),
    active BOOLEAN DEFAULT true NOT NULL,
    settings JSONB DEFAULT '{}' NOT NULL,
    webhook_secret VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Constraints
    CONSTRAINT chk_agents_platform CHECK (
        platform IN ('whatsapp', 'telegram', 'both', 'instagram', 'messenger', 'web')
    ),
    -- Unique phone per platform (allow NULL)
    CONSTRAINT uq_agents_platform_phone UNIQUE (platform, phone)
);

-- Foreign key with ON DELETE CASCADE
ALTER TABLE agents DROP CONSTRAINT IF EXISTS fk_agents_account;
ALTER TABLE agents
    ADD CONSTRAINT fk_agents_account
    FOREIGN KEY (account_id) REFERENCES accounts(id)
    ON DELETE CASCADE;

-- ============================================================================
-- ADMIN_USERS TABLE
-- Dashboard users with authentication
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100),
    role VARCHAR(20) DEFAULT 'viewer' NOT NULL,
    active BOOLEAN DEFAULT true NOT NULL,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Constraints
    CONSTRAINT chk_admin_users_role CHECK (
        role IN ('admin', 'manager', 'viewer')
    )
);

-- Foreign key
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS fk_admin_users_account;
ALTER TABLE admin_users
    ADD CONSTRAINT fk_admin_users_account
    FOREIGN KEY (account_id) REFERENCES accounts(id)
    ON DELETE CASCADE;

-- ============================================================================
-- UPDATE LEADS TABLE
-- Add agent reference and additional tracking fields
-- ============================================================================

-- Add agent_id column (nullable for backwards compatibility)
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS agent_id UUID;

-- Add lost_reason for better analytics
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS lost_reason VARCHAR(100);

-- Add lead_value for revenue tracking
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS lead_value DECIMAL(10,2);

-- Foreign key with ON DELETE SET NULL (don't delete leads if agent deleted)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS fk_leads_agent;
ALTER TABLE leads
    ADD CONSTRAINT fk_leads_agent
    FOREIGN KEY (agent_id) REFERENCES agents(id)
    ON DELETE SET NULL;

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
CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at);

-- Agents indexes
CREATE INDEX IF NOT EXISTS idx_agents_account_id ON agents(account_id);
CREATE INDEX IF NOT EXISTS idx_agents_platform ON agents(platform);
CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_agents_phone ON agents(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at);

-- Admin users indexes
CREATE INDEX IF NOT EXISTS idx_admin_users_account_id ON admin_users(account_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_active ON admin_users(active) WHERE active = true;

-- Leads agent index
CREATE INDEX IF NOT EXISTS idx_leads_agent_id ON leads(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lost_reason ON leads(lost_reason) WHERE lost_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_value ON leads(lead_value) WHERE lead_value IS NOT NULL;

-- ============================================================================
-- DEFAULT DATA
-- Create default account and agent for existing installation
-- ============================================================================

-- Create default account
INSERT INTO accounts (id, name, slug, plan, status, settings, created_at, updated_at)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Ask ROIE',
    'ask-roie',
    'enterprise',
    'active',
    '{"timezone": "Asia/Jerusalem", "language": "he"}',
    NOW(),
    NOW()
)
ON CONFLICT (slug) DO UPDATE SET
    updated_at = NOW();

-- Create default WhatsApp agent
INSERT INTO agents (id, account_id, name, platform, active, settings, created_at, updated_at)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Ask ROIE WhatsApp',
    'whatsapp',
    true,
    '{"greeting_enabled": true}',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    updated_at = NOW();

-- Create default Telegram agent
INSERT INTO agents (id, account_id, name, platform, active, settings, created_at, updated_at)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'Ask ROIE Telegram',
    'telegram',
    true,
    '{"greeting_enabled": true}',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    updated_at = NOW();

-- Create default "both" agent for combined usage
INSERT INTO agents (id, account_id, name, platform, active, settings, created_at, updated_at)
VALUES (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'Ask ROIE Bot',
    'both',
    true,
    '{"greeting_enabled": true}',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    updated_at = NOW();

-- Migrate existing leads to default agent (WhatsApp)
UPDATE leads
SET agent_id = '00000000-0000-0000-0000-000000000001'
WHERE agent_id IS NULL;

-- ============================================================================
-- TRIGGER: Auto-update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Accounts trigger
DROP TRIGGER IF EXISTS update_accounts_updated_at ON accounts;
CREATE TRIGGER update_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Agents trigger
DROP TRIGGER IF EXISTS update_agents_updated_at ON agents;
CREATE TRIGGER update_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Admin users trigger
DROP TRIGGER IF EXISTS update_admin_users_updated_at ON admin_users;
CREATE TRIGGER update_admin_users_updated_at
    BEFORE UPDATE ON admin_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE accounts IS 'Multi-tenant accounts/organizations';
COMMENT ON TABLE agents IS 'Bot agents per account (WhatsApp, Telegram, etc.)';
COMMENT ON TABLE admin_users IS 'Dashboard admin users with authentication';
COMMENT ON COLUMN leads.agent_id IS 'Reference to the agent that owns this lead';
COMMENT ON COLUMN leads.lost_reason IS 'Reason for marking lead as lost';
COMMENT ON COLUMN leads.lead_value IS 'Estimated or actual revenue value of lead';
