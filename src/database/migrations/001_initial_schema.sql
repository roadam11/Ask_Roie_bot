-- Ask ROIE Bot - Initial Database Schema
-- Migration: 001_initial_schema.sql
-- Created: 2024-01-01
-- Description: Creates the core tables for the WhatsApp AI Sales Agent

-- ============================================================================
-- LEADS TABLE
-- Stores all lead/prospect information
-- ============================================================================

CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100),
    subjects TEXT[],
    level VARCHAR(50),
    grade_details TEXT,
    format_preference VARCHAR(20),
    status VARCHAR(20) DEFAULT 'new' NOT NULL,
    parent_or_student VARCHAR(20),
    has_exam BOOLEAN DEFAULT FALSE,
    urgency VARCHAR(20) DEFAULT 'medium',
    objection_type VARCHAR(50),
    trial_offered BOOLEAN DEFAULT FALSE,
    booking_completed BOOLEAN DEFAULT FALSE,
    booked_at TIMESTAMP,
    calendly_event_uri VARCHAR(255),
    opted_out BOOLEAN DEFAULT FALSE,
    needs_human_followup BOOLEAN DEFAULT FALSE,
    last_user_message_at TIMESTAMP,
    last_bot_message_at TIMESTAMP,
    last_followup_sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Constraints for valid enum values
    CONSTRAINT chk_leads_level CHECK (
        level IS NULL OR level IN ('elementary', 'middle_school', 'high_school', 'college')
    ),
    CONSTRAINT chk_leads_format_preference CHECK (
        format_preference IS NULL OR format_preference IN ('zoom', 'frontal', 'undecided')
    ),
    CONSTRAINT chk_leads_status CHECK (
        status IN ('new', 'qualified', 'considering', 'hesitant', 'ready_to_book', 'booked', 'lost')
    ),
    CONSTRAINT chk_leads_parent_or_student CHECK (
        parent_or_student IS NULL OR parent_or_student IN ('parent', 'student', 'unknown')
    ),
    CONSTRAINT chk_leads_urgency CHECK (
        urgency IS NULL OR urgency IN ('high', 'medium', 'low')
    ),
    CONSTRAINT chk_leads_objection_type CHECK (
        objection_type IS NULL OR objection_type IN ('price', 'time', 'format', 'trust', 'other', 'none')
    )
);

-- ============================================================================
-- MESSAGES TABLE
-- Stores conversation history between leads and the bot
-- ============================================================================

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    role VARCHAR(10) NOT NULL,
    content TEXT NOT NULL,
    whatsapp_message_id VARCHAR(100),
    tokens_used INTEGER,
    model_used VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Constraints
    CONSTRAINT chk_messages_role CHECK (role IN ('user', 'bot', 'system'))
);

-- ============================================================================
-- FOLLOWUPS TABLE
-- Stores scheduled follow-up messages
-- ============================================================================

CREATE TABLE IF NOT EXISTS followups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    scheduled_for TIMESTAMP NOT NULL,
    type VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    message_template VARCHAR(50),
    template_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    sent_at TIMESTAMP,

    -- Constraints
    CONSTRAINT chk_followups_type CHECK (type IN ('24h', '72h', '7d')),
    CONSTRAINT chk_followups_status CHECK (status IN ('pending', 'sent', 'cancelled'))
);

-- ============================================================================
-- ANALYTICS TABLE
-- Stores events for analytics and cost tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    metadata JSONB,
    cost_usd DECIMAL(10, 4),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- INDEXES
-- Performance optimization for common queries
-- ============================================================================

-- Leads indexes
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_last_user_message_at ON leads(last_user_message_at);

-- Messages indexes
CREATE INDEX IF NOT EXISTS idx_messages_lead_id ON messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Followups indexes
CREATE INDEX IF NOT EXISTS idx_followups_scheduled_for_status ON followups(scheduled_for, status);

-- Analytics indexes
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics(created_at);

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

CREATE TRIGGER update_leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- Documentation for tables and columns
-- ============================================================================

COMMENT ON TABLE leads IS 'Stores lead/prospect information for the Ask ROIE tutoring service';
COMMENT ON TABLE messages IS 'Conversation history between leads and the AI bot';
COMMENT ON TABLE followups IS 'Scheduled follow-up messages for lead nurturing';
COMMENT ON TABLE analytics IS 'Event tracking and cost analytics';

COMMENT ON COLUMN leads.phone IS 'WhatsApp phone number with country code';
COMMENT ON COLUMN leads.subjects IS 'Array of subjects the lead is interested in';
COMMENT ON COLUMN leads.level IS 'Education level: elementary, middle_school, high_school, college';
COMMENT ON COLUMN leads.format_preference IS 'Preferred tutoring format: zoom, frontal, undecided';
COMMENT ON COLUMN leads.status IS 'Sales pipeline status';
COMMENT ON COLUMN leads.urgency IS 'Lead urgency level based on exam dates or immediate needs';
COMMENT ON COLUMN leads.objection_type IS 'Primary objection type raised by the lead';
COMMENT ON COLUMN leads.needs_human_followup IS 'Flag for leads requiring human intervention';

COMMENT ON COLUMN messages.role IS 'Message sender: user (lead), bot (AI), system (internal)';
COMMENT ON COLUMN messages.tokens_used IS 'Claude API tokens consumed for this message';

COMMENT ON COLUMN followups.type IS 'Follow-up timing: 24h, 72h, 7d after last contact';
COMMENT ON COLUMN followups.status IS 'Follow-up status: pending, sent, cancelled';

COMMENT ON COLUMN analytics.cost_usd IS 'Cost in USD for API calls or operations';
COMMENT ON COLUMN analytics.metadata IS 'Additional event data in JSON format';
