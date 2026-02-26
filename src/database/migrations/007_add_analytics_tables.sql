-- Ask ROIE Bot - Analytics & QA Module
-- Migration: 007_add_analytics_tables.sql
-- Created: 2026-02-26
-- Description: Adds advanced analytics, conversation search, QA flags, and alerts

-- ============================================================================
-- CONVERSATION_SEARCH TABLE
-- Full-text search index for conversations
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversation_search (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL,
    lead_id UUID NOT NULL,
    agent_id UUID,

    -- Searchable content
    content_text TEXT NOT NULL,
    content_tsvector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('hebrew', content_text)
    ) STORED,

    -- Denormalized for fast filtering
    platform VARCHAR(20),
    primary_intent VARCHAR(50),
    avg_confidence DECIMAL(5,4),
    outcome VARCHAR(30),
    lead_state VARCHAR(30),
    message_count INTEGER DEFAULT 0,

    -- Timestamps
    first_message_at TIMESTAMP NOT NULL,
    last_message_at TIMESTAMP NOT NULL,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Constraints
    CONSTRAINT chk_search_outcome CHECK (
        outcome IS NULL OR outcome IN (
            'booked', 'qualified', 'not_interested', 'needs_followup',
            'escalated_to_human', 'opted_out', 'pending'
        )
    )
);

-- Foreign keys
ALTER TABLE conversation_search
    ADD CONSTRAINT fk_search_conversation
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;

ALTER TABLE conversation_search
    ADD CONSTRAINT fk_search_lead
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE conversation_search
    ADD CONSTRAINT fk_search_agent
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;

-- ============================================================================
-- QA_FLAGS TABLE
-- Quality assurance flags for conversation review
-- ============================================================================

CREATE TABLE IF NOT EXISTS qa_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL,
    message_id UUID,

    -- Flag details
    flag_type VARCHAR(30) NOT NULL,
    severity VARCHAR(20) DEFAULT 'medium' NOT NULL,
    reason TEXT NOT NULL,

    -- Auto vs Manual
    is_auto_flagged BOOLEAN DEFAULT false NOT NULL,
    auto_flag_rule VARCHAR(100),

    -- Resolution
    status VARCHAR(20) DEFAULT 'open' NOT NULL,
    resolution_notes TEXT,
    resolved_by UUID,
    resolved_at TIMESTAMP,

    -- Metadata
    flagged_by UUID,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Constraints
    CONSTRAINT chk_qa_flags_type CHECK (
        flag_type IN (
            'low_confidence',
            'incorrect_response',
            'hallucination',
            'missed_intent',
            'poor_tone',
            'compliance_issue',
            'escalation_needed',
            'training_opportunity',
            'edge_case',
            'other'
        )
    ),
    CONSTRAINT chk_qa_flags_severity CHECK (
        severity IN ('low', 'medium', 'high', 'critical')
    ),
    CONSTRAINT chk_qa_flags_status CHECK (
        status IN ('open', 'in_review', 'resolved', 'wont_fix', 'training_added')
    )
);

-- Foreign keys
ALTER TABLE qa_flags
    ADD CONSTRAINT fk_qa_flags_conversation
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;

ALTER TABLE qa_flags
    ADD CONSTRAINT fk_qa_flags_message
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;

ALTER TABLE qa_flags
    ADD CONSTRAINT fk_qa_flags_resolved_by
    FOREIGN KEY (resolved_by) REFERENCES admin_users(id) ON DELETE SET NULL;

ALTER TABLE qa_flags
    ADD CONSTRAINT fk_qa_flags_flagged_by
    FOREIGN KEY (flagged_by) REFERENCES admin_users(id) ON DELETE SET NULL;

-- ============================================================================
-- ANALYTICS_SNAPSHOTS TABLE
-- Pre-computed analytics for fast dashboard loading
-- ============================================================================

CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    agent_id UUID,

    -- Snapshot period
    period_type VARCHAR(20) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    -- Conversion metrics by segment (JSONB for flexibility)
    conversion_by_subject JSONB DEFAULT '{}' NOT NULL,
    conversion_by_source JSONB DEFAULT '{}' NOT NULL,
    conversion_by_grade JSONB DEFAULT '{}' NOT NULL,
    conversion_by_hour JSONB DEFAULT '{}' NOT NULL,

    -- Funnel metrics
    funnel_stages JSONB DEFAULT '{}' NOT NULL,
    stage_durations JSONB DEFAULT '{}' NOT NULL,
    dropoff_rates JSONB DEFAULT '{}' NOT NULL,
    bottlenecks JSONB DEFAULT '[]' NOT NULL,

    -- AI performance
    ai_performance JSONB DEFAULT '{}' NOT NULL,
    intent_success_rates JSONB DEFAULT '{}' NOT NULL,
    confidence_distribution JSONB DEFAULT '{}' NOT NULL,
    tool_usage_stats JSONB DEFAULT '{}' NOT NULL,

    -- Revenue metrics
    revenue_metrics JSONB DEFAULT '{}' NOT NULL,
    pipeline_velocity JSONB DEFAULT '{}' NOT NULL,
    value_distribution JSONB DEFAULT '{}' NOT NULL,

    -- Metadata
    computed_at TIMESTAMP DEFAULT NOW() NOT NULL,
    computation_time_ms INTEGER,

    -- Constraints
    CONSTRAINT chk_snapshots_period_type CHECK (
        period_type IN ('daily', 'weekly', 'monthly', 'quarterly')
    ),
    CONSTRAINT uq_snapshots_unique UNIQUE (account_id, agent_id, period_type, period_start)
);

-- Foreign keys
ALTER TABLE analytics_snapshots
    ADD CONSTRAINT fk_snapshots_account
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE analytics_snapshots
    ADD CONSTRAINT fk_snapshots_agent
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;

-- ============================================================================
-- ALERTS TABLE
-- System alerts for command center
-- ============================================================================

CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    agent_id UUID,

    -- Alert details
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) DEFAULT 'info' NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,

    -- Reference to source
    reference_type VARCHAR(30),
    reference_id UUID,

    -- Action required
    action_required BOOLEAN DEFAULT false NOT NULL,
    action_url VARCHAR(500),
    action_label VARCHAR(100),

    -- Status
    status VARCHAR(20) DEFAULT 'active' NOT NULL,
    acknowledged_by UUID,
    acknowledged_at TIMESTAMP,
    resolved_at TIMESTAMP,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMP,

    -- Constraints
    CONSTRAINT chk_alerts_type CHECK (
        alert_type IN (
            'pending_approval',
            'stuck_conversation',
            'failed_followup',
            'low_confidence',
            'quota_warning',
            'high_latency',
            'error_spike',
            'conversion_drop',
            'new_lead_surge',
            'system_health'
        )
    ),
    CONSTRAINT chk_alerts_severity CHECK (
        severity IN ('info', 'warning', 'error', 'critical')
    ),
    CONSTRAINT chk_alerts_status CHECK (
        status IN ('active', 'acknowledged', 'resolved', 'expired')
    )
);

-- Foreign keys
ALTER TABLE alerts
    ADD CONSTRAINT fk_alerts_account
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE alerts
    ADD CONSTRAINT fk_alerts_agent
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;

ALTER TABLE alerts
    ADD CONSTRAINT fk_alerts_acknowledged_by
    FOREIGN KEY (acknowledged_by) REFERENCES admin_users(id) ON DELETE SET NULL;

-- ============================================================================
-- ENHANCE AI_TELEMETRY TABLE
-- Add decision path, entities, and fallback tracking
-- ============================================================================

-- Decision path: step-by-step reasoning
ALTER TABLE ai_telemetry
ADD COLUMN IF NOT EXISTS decision_path JSONB DEFAULT '[]';

-- Rule that triggered this response
ALTER TABLE ai_telemetry
ADD COLUMN IF NOT EXISTS rule_triggered_id UUID;

-- Entities extracted from user message
ALTER TABLE ai_telemetry
ADD COLUMN IF NOT EXISTS entities_extracted JSONB DEFAULT '{}';

-- Conversation turn number
ALTER TABLE ai_telemetry
ADD COLUMN IF NOT EXISTS conversation_turn INTEGER DEFAULT 1;

-- Fallback tracking
ALTER TABLE ai_telemetry
ADD COLUMN IF NOT EXISTS is_fallback BOOLEAN DEFAULT false;

ALTER TABLE ai_telemetry
ADD COLUMN IF NOT EXISTS fallback_reason VARCHAR(100);

-- Human takeover tracking
ALTER TABLE ai_telemetry
ADD COLUMN IF NOT EXISTS human_takeover BOOLEAN DEFAULT false;

ALTER TABLE ai_telemetry
ADD COLUMN IF NOT EXISTS takeover_reason VARCHAR(100);

-- Foreign key for rule_triggered_id
ALTER TABLE ai_telemetry DROP CONSTRAINT IF EXISTS fk_telemetry_rule_triggered;
ALTER TABLE ai_telemetry
    ADD CONSTRAINT fk_telemetry_rule_triggered
    FOREIGN KEY (rule_triggered_id) REFERENCES automation_rules(id) ON DELETE SET NULL;

-- Add constraint for fallback reasons
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_telemetry_fallback_reason'
    ) THEN
        ALTER TABLE ai_telemetry
        ADD CONSTRAINT chk_telemetry_fallback_reason CHECK (
            fallback_reason IS NULL OR fallback_reason IN (
                'low_confidence',
                'unknown_intent',
                'complex_query',
                'user_requested',
                'policy_violation',
                'error_occurred',
                'loop_detected',
                'timeout'
            )
        );
    END IF;
END $$;

-- ============================================================================
-- INDEXES
-- ============================================================================

-- conversation_search indexes
CREATE INDEX IF NOT EXISTS idx_conv_search_tsvector
    ON conversation_search USING GIN(content_tsvector);
CREATE INDEX IF NOT EXISTS idx_conv_search_conversation_id
    ON conversation_search(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_search_lead_id
    ON conversation_search(lead_id);
CREATE INDEX IF NOT EXISTS idx_conv_search_agent_id
    ON conversation_search(agent_id);
CREATE INDEX IF NOT EXISTS idx_conv_search_platform
    ON conversation_search(platform);
CREATE INDEX IF NOT EXISTS idx_conv_search_intent
    ON conversation_search(primary_intent);
CREATE INDEX IF NOT EXISTS idx_conv_search_outcome
    ON conversation_search(outcome);
CREATE INDEX IF NOT EXISTS idx_conv_search_state
    ON conversation_search(lead_state);
CREATE INDEX IF NOT EXISTS idx_conv_search_confidence
    ON conversation_search(avg_confidence);
CREATE INDEX IF NOT EXISTS idx_conv_search_dates
    ON conversation_search(first_message_at, last_message_at);

-- qa_flags indexes
CREATE INDEX IF NOT EXISTS idx_qa_flags_conversation_id
    ON qa_flags(conversation_id);
CREATE INDEX IF NOT EXISTS idx_qa_flags_message_id
    ON qa_flags(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qa_flags_status_open
    ON qa_flags(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_qa_flags_type
    ON qa_flags(flag_type);
CREATE INDEX IF NOT EXISTS idx_qa_flags_severity
    ON qa_flags(severity);
CREATE INDEX IF NOT EXISTS idx_qa_flags_auto
    ON qa_flags(is_auto_flagged) WHERE is_auto_flagged = true;
CREATE INDEX IF NOT EXISTS idx_qa_flags_created_at
    ON qa_flags(created_at);

-- analytics_snapshots indexes
CREATE INDEX IF NOT EXISTS idx_analytics_account_period
    ON analytics_snapshots(account_id, period_type, period_start);
CREATE INDEX IF NOT EXISTS idx_analytics_agent_period
    ON analytics_snapshots(agent_id, period_type, period_start) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_computed_at
    ON analytics_snapshots(computed_at);
CREATE INDEX IF NOT EXISTS idx_analytics_period_type
    ON analytics_snapshots(period_type);

-- alerts indexes
CREATE INDEX IF NOT EXISTS idx_alerts_account_id
    ON alerts(account_id);
CREATE INDEX IF NOT EXISTS idx_alerts_agent_id
    ON alerts(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_status_active
    ON alerts(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_alerts_type
    ON alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_severity
    ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_action_required
    ON alerts(action_required) WHERE action_required = true;
CREATE INDEX IF NOT EXISTS idx_alerts_created_at
    ON alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_expires_at
    ON alerts(expires_at) WHERE expires_at IS NOT NULL;

-- ai_telemetry new column indexes
CREATE INDEX IF NOT EXISTS idx_telemetry_rule_triggered
    ON ai_telemetry(rule_triggered_id) WHERE rule_triggered_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_telemetry_is_fallback
    ON ai_telemetry(is_fallback) WHERE is_fallback = true;
CREATE INDEX IF NOT EXISTS idx_telemetry_human_takeover
    ON ai_telemetry(human_takeover) WHERE human_takeover = true;
CREATE INDEX IF NOT EXISTS idx_telemetry_conversation_turn
    ON ai_telemetry(conversation_id, conversation_turn);
CREATE INDEX IF NOT EXISTS idx_telemetry_entities
    ON ai_telemetry USING GIN(entities_extracted);

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Real-time AI performance snapshot for command center
CREATE OR REPLACE VIEW v_ai_performance_snapshot AS
SELECT
    agent_id,
    COUNT(*) as total_interactions,
    COUNT(DISTINCT conversation_id) as total_conversations,
    COUNT(*) FILTER (WHERE NOT COALESCE(human_takeover, false)) as ai_only,
    COUNT(*) FILTER (WHERE COALESCE(human_takeover, false)) as human_assisted,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE NOT COALESCE(human_takeover, false)) /
        NULLIF(COUNT(*), 0), 1
    ) as ai_handled_pct,
    COUNT(*) FILTER (
        WHERE NOT COALESCE(human_takeover, false)
        AND detected_intent = 'booking_confirm'
    ) as ai_bookings,
    ROUND(AVG(intent_confidence) * 100, 1) as avg_confidence_pct,
    ROUND(AVG(latency_ms)) as avg_latency_ms,
    SUM(total_tokens) as total_tokens,
    ROUND(SUM(COALESCE(cost_usd, 0))::NUMERIC, 4) as total_cost_usd
FROM ai_telemetry
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY agent_id;

-- Funnel stage analysis with conversion rates
CREATE OR REPLACE VIEW v_funnel_analysis AS
WITH stage_counts AS (
    SELECT
        COALESCE(agent_id, '00000000-0000-0000-0000-000000000001'::UUID) as agent_id,
        status as stage,
        COUNT(*) as count,
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600) as avg_hours_in_stage
    FROM leads
    WHERE created_at > NOW() - INTERVAL '30 days'
    GROUP BY COALESCE(agent_id, '00000000-0000-0000-0000-000000000001'::UUID), status
),
stage_order AS (
    SELECT
        stage,
        CASE stage
            WHEN 'new' THEN 1
            WHEN 'qualified' THEN 2
            WHEN 'considering' THEN 3
            WHEN 'hesitant' THEN 4
            WHEN 'ready_to_book' THEN 5
            WHEN 'booked' THEN 6
            WHEN 'lost' THEN 7
        END as stage_num
    FROM (VALUES
        ('new'), ('qualified'), ('considering'),
        ('hesitant'), ('ready_to_book'), ('booked'), ('lost')
    ) AS s(stage)
)
SELECT
    sc.agent_id,
    sc.stage,
    so.stage_num,
    sc.count,
    ROUND(sc.avg_hours_in_stage, 1) as avg_hours_in_stage,
    ROUND(
        100.0 * sc.count /
        NULLIF(FIRST_VALUE(sc.count) OVER (PARTITION BY sc.agent_id ORDER BY so.stage_num), 0),
        1
    ) as pct_of_total,
    CASE
        WHEN so.stage_num <= 5 AND sc.count < LAG(sc.count) OVER (PARTITION BY sc.agent_id ORDER BY so.stage_num) * 0.7
        THEN true
        ELSE false
    END as is_bottleneck
FROM stage_counts sc
JOIN stage_order so ON sc.stage = so.stage
ORDER BY sc.agent_id, so.stage_num;

-- Intent success rates
CREATE OR REPLACE VIEW v_intent_success_rates AS
SELECT
    agent_id,
    detected_intent,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE user_satisfaction_signal = 'positive') as positive,
    COUNT(*) FILTER (WHERE user_satisfaction_signal = 'negative') as negative,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE user_satisfaction_signal = 'positive') /
        NULLIF(COUNT(*), 0), 1
    ) as success_rate_pct,
    ROUND(AVG(intent_confidence) * 100, 1) as avg_confidence_pct,
    ROUND(AVG(latency_ms)) as avg_latency_ms
FROM ai_telemetry
WHERE detected_intent IS NOT NULL
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY agent_id, detected_intent
ORDER BY agent_id, total DESC;

-- Active alerts summary
CREATE OR REPLACE VIEW v_active_alerts_summary AS
SELECT
    account_id,
    alert_type,
    severity,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE action_required) as action_required_count,
    MIN(created_at) as oldest_at,
    MAX(created_at) as newest_at
FROM alerts
WHERE status = 'active'
GROUP BY account_id, alert_type, severity
ORDER BY
    CASE severity
        WHEN 'critical' THEN 1
        WHEN 'error' THEN 2
        WHEN 'warning' THEN 3
        WHEN 'info' THEN 4
    END,
    count DESC;

-- QA flags summary
CREATE OR REPLACE VIEW v_qa_flags_summary AS
SELECT
    flag_type,
    severity,
    status,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE is_auto_flagged) as auto_flagged,
    COUNT(*) FILTER (WHERE NOT is_auto_flagged) as manual_flagged,
    AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, NOW()) - created_at)) / 3600) as avg_resolution_hours
FROM qa_flags
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY flag_type, severity, status
ORDER BY
    CASE status WHEN 'open' THEN 1 WHEN 'in_review' THEN 2 ELSE 3 END,
    CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
    count DESC;

-- ============================================================================
-- MATERIALIZED VIEW FOR CONVERSION ANALYTICS
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_conversion_by_segment AS
SELECT
    COALESCE(l.agent_id, '00000000-0000-0000-0000-000000000001'::UUID) as agent_id,
    DATE_TRUNC('week', l.created_at)::DATE as week_start,
    COALESCE(l.subject, 'unknown') as subject,
    COALESCE(l.education_level, 'unknown') as education_level,
    COUNT(*) as total_leads,
    COUNT(*) FILTER (WHERE l.status = 'booked') as booked_count,
    COUNT(*) FILTER (WHERE l.status = 'lost') as lost_count,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE l.status = 'booked') / NULLIF(COUNT(*), 0), 2
    ) as conversion_rate,
    ROUND(AVG(COALESCE(l.lead_value, 0)), 2) as avg_lead_value,
    SUM(COALESCE(l.lead_value, 0)) FILTER (WHERE l.status = 'booked') as total_revenue
FROM leads l
WHERE l.created_at > NOW() - INTERVAL '90 days'
GROUP BY
    COALESCE(l.agent_id, '00000000-0000-0000-0000-000000000001'::UUID),
    DATE_TRUNC('week', l.created_at)::DATE,
    COALESCE(l.subject, 'unknown'),
    COALESCE(l.education_level, 'unknown');

-- Index for the materialized view
CREATE INDEX IF NOT EXISTS idx_mv_conversion_agent_week
    ON mv_conversion_by_segment(agent_id, week_start);
CREATE INDEX IF NOT EXISTS idx_mv_conversion_subject
    ON mv_conversion_by_segment(subject);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Reuse the function from earlier migrations
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- conversation_search trigger
DROP TRIGGER IF EXISTS update_conversation_search_updated_at ON conversation_search;
CREATE TRIGGER update_conversation_search_updated_at
    BEFORE UPDATE ON conversation_search
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to search conversations with full-text search
CREATE OR REPLACE FUNCTION search_conversations(
    p_search_text TEXT,
    p_agent_id UUID DEFAULT NULL,
    p_platform VARCHAR DEFAULT NULL,
    p_intent VARCHAR DEFAULT NULL,
    p_outcome VARCHAR DEFAULT NULL,
    p_confidence_min DECIMAL DEFAULT NULL,
    p_confidence_max DECIMAL DEFAULT NULL,
    p_date_from TIMESTAMP DEFAULT NULL,
    p_date_to TIMESTAMP DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    conversation_id UUID,
    lead_id UUID,
    content_snippet TEXT,
    platform VARCHAR,
    primary_intent VARCHAR,
    avg_confidence DECIMAL,
    outcome VARCHAR,
    message_count INTEGER,
    first_message_at TIMESTAMP,
    last_message_at TIMESTAMP,
    search_rank REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        cs.conversation_id,
        cs.lead_id,
        ts_headline('hebrew', cs.content_text, plainto_tsquery('hebrew', p_search_text),
            'MaxWords=50, MinWords=20, StartSel=<mark>, StopSel=</mark>') as content_snippet,
        cs.platform,
        cs.primary_intent,
        cs.avg_confidence,
        cs.outcome,
        cs.message_count,
        cs.first_message_at,
        cs.last_message_at,
        ts_rank(cs.content_tsvector, plainto_tsquery('hebrew', p_search_text)) as search_rank
    FROM conversation_search cs
    WHERE
        (p_search_text IS NULL OR cs.content_tsvector @@ plainto_tsquery('hebrew', p_search_text))
        AND (p_agent_id IS NULL OR cs.agent_id = p_agent_id)
        AND (p_platform IS NULL OR cs.platform = p_platform)
        AND (p_intent IS NULL OR cs.primary_intent = p_intent)
        AND (p_outcome IS NULL OR cs.outcome = p_outcome)
        AND (p_confidence_min IS NULL OR cs.avg_confidence >= p_confidence_min)
        AND (p_confidence_max IS NULL OR cs.avg_confidence <= p_confidence_max)
        AND (p_date_from IS NULL OR cs.first_message_at >= p_date_from)
        AND (p_date_to IS NULL OR cs.last_message_at <= p_date_to)
    ORDER BY
        CASE WHEN p_search_text IS NOT NULL
            THEN ts_rank(cs.content_tsvector, plainto_tsquery('hebrew', p_search_text))
            ELSE 0
        END DESC,
        cs.last_message_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Function to generate alerts for stuck conversations
CREATE OR REPLACE FUNCTION generate_stuck_conversation_alerts(
    p_account_id UUID,
    p_hours_threshold INTEGER DEFAULT 24
)
RETURNS INTEGER AS $$
DECLARE
    v_alert_count INTEGER := 0;
BEGIN
    INSERT INTO alerts (
        account_id,
        agent_id,
        alert_type,
        severity,
        title,
        description,
        reference_type,
        reference_id,
        action_required,
        action_label
    )
    SELECT
        a.account_id,
        l.agent_id,
        'stuck_conversation',
        CASE
            WHEN EXTRACT(EPOCH FROM (NOW() - l.last_message_at)) / 3600 > 48 THEN 'error'
            ELSE 'warning'
        END,
        'Stuck conversation: ' || COALESCE(l.name, l.phone),
        'No response for ' || ROUND(EXTRACT(EPOCH FROM (NOW() - l.last_message_at)) / 3600) || ' hours',
        'lead',
        l.id,
        true,
        'View Lead'
    FROM leads l
    JOIN agents a ON a.id = l.agent_id
    WHERE
        a.account_id = p_account_id
        AND l.status NOT IN ('booked', 'lost')
        AND l.last_message_at < NOW() - (p_hours_threshold || ' hours')::INTERVAL
        AND NOT EXISTS (
            SELECT 1 FROM alerts al
            WHERE al.reference_type = 'lead'
              AND al.reference_id = l.id
              AND al.alert_type = 'stuck_conversation'
              AND al.status = 'active'
        );

    GET DIAGNOSTICS v_alert_count = ROW_COUNT;
    RETURN v_alert_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE conversation_search IS 'Full-text search index for conversations';
COMMENT ON TABLE qa_flags IS 'Quality assurance flags for conversation review';
COMMENT ON TABLE analytics_snapshots IS 'Pre-computed analytics snapshots for fast dashboard loading';
COMMENT ON TABLE alerts IS 'System alerts for command center dashboard';

COMMENT ON COLUMN ai_telemetry.decision_path IS 'JSON array of reasoning steps taken by AI';
COMMENT ON COLUMN ai_telemetry.entities_extracted IS 'JSON object of entities extracted from user message';
COMMENT ON COLUMN ai_telemetry.is_fallback IS 'Whether this was a fallback/error response';
COMMENT ON COLUMN ai_telemetry.human_takeover IS 'Whether a human took over this conversation';

COMMENT ON VIEW v_ai_performance_snapshot IS 'Real-time AI performance metrics for last 7 days';
COMMENT ON VIEW v_funnel_analysis IS 'Sales funnel analysis with bottleneck detection';
COMMENT ON VIEW v_intent_success_rates IS 'Success rates by detected intent';
COMMENT ON VIEW v_active_alerts_summary IS 'Summary of active alerts by type and severity';
COMMENT ON VIEW v_qa_flags_summary IS 'Summary of QA flags by type, severity, and status';

COMMENT ON MATERIALIZED VIEW mv_conversion_by_segment IS 'Weekly conversion rates by segment - refresh daily';

COMMENT ON FUNCTION search_conversations IS 'Full-text search with filters for conversation browser';
COMMENT ON FUNCTION generate_stuck_conversation_alerts IS 'Generate alerts for conversations with no recent activity';
