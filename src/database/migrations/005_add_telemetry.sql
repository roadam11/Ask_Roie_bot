-- Ask ROIE Bot - AI Telemetry & Prompt Versioning
-- Migration: 005_add_telemetry.sql
-- Created: 2026-02-25
-- Description: Adds AI telemetry tracking and prompt version management

-- ============================================================================
-- PROMPT_VERSIONS TABLE
-- Stores different versions of system prompts for A/B testing and rollback
-- ============================================================================

CREATE TABLE IF NOT EXISTS prompt_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    version_name VARCHAR(50) NOT NULL,
    version_number INTEGER NOT NULL,
    description TEXT,
    system_prompt TEXT NOT NULL,
    tools_config JSONB DEFAULT '[]',
    active BOOLEAN DEFAULT false NOT NULL,
    is_default BOOLEAN DEFAULT false NOT NULL,
    performance_score DECIMAL(5,2),
    conversion_rate DECIMAL(5,4),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    created_by VARCHAR(100),
    activated_at TIMESTAMP,
    deactivated_at TIMESTAMP,

    -- Unique version per account
    CONSTRAINT uq_prompt_versions_account_version UNIQUE (account_id, version_number)
);

-- ============================================================================
-- CONVERSATIONS TABLE
-- Groups messages into logical conversations for analytics
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    started_at TIMESTAMP DEFAULT NOW() NOT NULL,
    ended_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active' NOT NULL,
    message_count INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    outcome VARCHAR(30),
    sentiment_score DECIMAL(3,2),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Constraints
    CONSTRAINT chk_conversations_status CHECK (
        status IN ('active', 'completed', 'abandoned', 'escalated')
    ),
    CONSTRAINT chk_conversations_outcome CHECK (
        outcome IS NULL OR outcome IN (
            'booked',
            'qualified',
            'not_interested',
            'needs_followup',
            'escalated_to_human',
            'opted_out'
        )
    )
);

-- ============================================================================
-- AI_TELEMETRY TABLE
-- Tracks every AI interaction for debugging, analytics, and optimization
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    prompt_version_id UUID REFERENCES prompt_versions(id) ON DELETE SET NULL,

    -- Intent Detection
    detected_intent VARCHAR(50),
    intent_confidence DECIMAL(5,4),
    secondary_intents JSONB DEFAULT '[]',

    -- AI Reasoning
    reasoning TEXT,
    decision_path JSONB,

    -- Performance Metrics
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
    latency_ms INTEGER NOT NULL,
    model_name VARCHAR(50),

    -- Tool Usage
    tool_calls JSONB DEFAULT '[]',
    tool_call_count INTEGER DEFAULT 0,

    -- Quality Metrics
    response_quality_score DECIMAL(3,2),
    user_satisfaction_signal VARCHAR(20),

    -- Cost Tracking
    cost_usd DECIMAL(10,6),

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Constraints
    CONSTRAINT chk_telemetry_intent CHECK (
        detected_intent IS NULL OR detected_intent IN (
            'greeting',
            'inquiry',
            'qualification',
            'objection_price',
            'objection_time',
            'objection_format',
            'objection_trust',
            'booking_intent',
            'booking_confirm',
            'thinking',
            'followup_request',
            'human_request',
            'opt_out',
            'off_topic',
            'unclear'
        )
    ),
    CONSTRAINT chk_telemetry_satisfaction CHECK (
        user_satisfaction_signal IS NULL OR user_satisfaction_signal IN (
            'positive',
            'neutral',
            'negative',
            'unknown'
        )
    )
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Prompt versions indexes
CREATE INDEX IF NOT EXISTS idx_prompt_versions_account_id ON prompt_versions(account_id);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_active ON prompt_versions(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_prompt_versions_created_at ON prompt_versions(created_at);

-- Conversations indexes
CREATE INDEX IF NOT EXISTS idx_conversations_lead_id ON conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_outcome ON conversations(outcome) WHERE outcome IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_started_at ON conversations(started_at);

-- AI telemetry indexes
CREATE INDEX IF NOT EXISTS idx_telemetry_lead_id ON ai_telemetry(lead_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_conversation_id ON ai_telemetry(conversation_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_message_id ON ai_telemetry(message_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_agent_id ON ai_telemetry(agent_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_prompt_version_id ON ai_telemetry(prompt_version_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_detected_intent ON ai_telemetry(detected_intent);
CREATE INDEX IF NOT EXISTS idx_telemetry_created_at ON ai_telemetry(created_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_model_name ON ai_telemetry(model_name);

-- Composite index for analytics queries
CREATE INDEX IF NOT EXISTS idx_telemetry_analytics ON ai_telemetry(agent_id, created_at, detected_intent);

-- ============================================================================
-- DEFAULT PROMPT VERSION
-- ============================================================================

INSERT INTO prompt_versions (
    id,
    account_id,
    version_name,
    version_number,
    description,
    system_prompt,
    active,
    is_default,
    created_by
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'v1.0-production',
    1,
    'Initial production prompt with follow-up automation',
    'See src/prompts/system-prompt.ts for full prompt',
    true,
    true,
    'system'
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- VIEWS FOR ANALYTICS
-- ============================================================================

-- Daily telemetry summary
CREATE OR REPLACE VIEW v_daily_telemetry_summary AS
SELECT
    DATE(created_at) as date,
    agent_id,
    COUNT(*) as total_interactions,
    COUNT(DISTINCT lead_id) as unique_leads,
    COUNT(DISTINCT conversation_id) as conversations,
    SUM(total_tokens) as total_tokens,
    AVG(latency_ms)::INTEGER as avg_latency_ms,
    SUM(cost_usd) as total_cost_usd,
    COUNT(*) FILTER (WHERE detected_intent = 'booking_confirm') as bookings,
    COUNT(*) FILTER (WHERE detected_intent = 'thinking') as thinking_signals
FROM ai_telemetry
GROUP BY DATE(created_at), agent_id;

-- Intent distribution
CREATE OR REPLACE VIEW v_intent_distribution AS
SELECT
    agent_id,
    detected_intent,
    COUNT(*) as count,
    AVG(intent_confidence) as avg_confidence,
    COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY agent_id) as percentage
FROM ai_telemetry
WHERE detected_intent IS NOT NULL
GROUP BY agent_id, detected_intent
ORDER BY agent_id, count DESC;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE prompt_versions IS 'System prompt versions for A/B testing and rollback';
COMMENT ON TABLE conversations IS 'Logical grouping of messages for analytics';
COMMENT ON TABLE ai_telemetry IS 'Detailed AI interaction telemetry for debugging and optimization';
COMMENT ON COLUMN ai_telemetry.detected_intent IS 'Primary intent detected from user message';
COMMENT ON COLUMN ai_telemetry.reasoning IS 'AI reasoning explanation for the response';
COMMENT ON COLUMN ai_telemetry.tool_calls IS 'JSON array of tool calls made during this interaction';

-- ============================================================================
-- TRIGGERS: Auto-update updated_at timestamp
-- ============================================================================

-- Reuse the function from 004 (or create if not exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Note: prompt_versions doesn't have updated_at by design (immutable versions)
-- conversations doesn't have updated_at (use ended_at instead)
