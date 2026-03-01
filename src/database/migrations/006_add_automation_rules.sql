-- Ask ROIE Bot - Automation Rules Engine
-- Migration: 006_add_automation_rules.sql
-- Created: 2026-02-25
-- Description: Configurable automation rules for follow-ups and triggers

-- ============================================================================
-- AUTOMATION_RULES TABLE
-- Configurable rules for automated follow-ups and actions
-- ============================================================================

CREATE TABLE IF NOT EXISTS automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,

    -- Rule Configuration
    name VARCHAR(100) NOT NULL,
    description TEXT,
    rule_type VARCHAR(30) NOT NULL,
    trigger_condition JSONB DEFAULT '{}' NOT NULL,

    -- Timing
    delay_hours INTEGER DEFAULT 24 NOT NULL,
    delay_minutes INTEGER DEFAULT 0,
    send_window_start TIME DEFAULT '09:00',
    send_window_end TIME DEFAULT '21:00',
    timezone VARCHAR(50) DEFAULT 'Asia/Jerusalem',

    -- Limits
    max_attempts INTEGER DEFAULT 3 NOT NULL,
    cooldown_hours INTEGER DEFAULT 24,

    -- Message Configuration
    message_template TEXT NOT NULL,
    include_calendly_link BOOLEAN DEFAULT true,
    message_variants JSONB DEFAULT '[]',

    -- Status
    active BOOLEAN DEFAULT true NOT NULL,
    priority INTEGER DEFAULT 50,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
    created_by VARCHAR(100),

    -- Constraints
    CONSTRAINT chk_rules_type CHECK (
        rule_type IN (
            'thinking_followup',
            'idle_followup',
            'trial_reminder',
            'trial_followup',
            'booking_confirmation',
            'welcome_sequence',
            're_engagement',
            'custom'
        )
    ),
    CONSTRAINT chk_rules_delay CHECK (delay_hours >= 0 AND delay_hours <= 168),
    CONSTRAINT chk_rules_max_attempts CHECK (max_attempts >= 1 AND max_attempts <= 10),
    CONSTRAINT chk_rules_priority CHECK (priority >= 0 AND priority <= 100)
);

-- ============================================================================
-- AUTOMATION_EXECUTIONS TABLE
-- Tracks execution history of automation rules
-- ============================================================================

CREATE TABLE IF NOT EXISTS automation_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    followup_id UUID REFERENCES followups(id) ON DELETE SET NULL,

    -- Execution Details
    status VARCHAR(20) DEFAULT 'pending' NOT NULL,
    scheduled_for TIMESTAMP NOT NULL,
    executed_at TIMESTAMP,
    attempt_number INTEGER DEFAULT 1 NOT NULL,

    -- Results
    message_sent TEXT,
    delivery_status VARCHAR(20),
    user_responded BOOLEAN DEFAULT false,
    response_time_minutes INTEGER,

    -- Error Tracking
    error_message TEXT,
    retry_scheduled_for TIMESTAMP,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Constraints
    CONSTRAINT chk_executions_status CHECK (
        status IN ('pending', 'scheduled', 'executing', 'sent', 'delivered', 'failed', 'cancelled', 'skipped')
    ),
    CONSTRAINT chk_executions_delivery CHECK (
        delivery_status IS NULL OR delivery_status IN ('sent', 'delivered', 'read', 'failed', 'blocked')
    )
);

-- ============================================================================
-- AUTOMATION_METRICS TABLE
-- Aggregated metrics for automation performance
-- ============================================================================

CREATE TABLE IF NOT EXISTS automation_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    date DATE NOT NULL,

    -- Execution Counts
    scheduled_count INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    delivered_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    cancelled_count INTEGER DEFAULT 0,

    -- Response Metrics
    response_count INTEGER DEFAULT 0,
    response_rate DECIMAL(5,4),
    avg_response_time_minutes INTEGER,

    -- Conversion Metrics
    booking_count INTEGER DEFAULT 0,
    conversion_rate DECIMAL(5,4),

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Unique per rule per day
    CONSTRAINT uq_automation_metrics_rule_date UNIQUE (rule_id, date)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Automation rules indexes
CREATE INDEX IF NOT EXISTS idx_rules_account_id ON automation_rules(account_id);
CREATE INDEX IF NOT EXISTS idx_rules_agent_id ON automation_rules(agent_id);
CREATE INDEX IF NOT EXISTS idx_rules_type ON automation_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_rules_active ON automation_rules(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_rules_priority ON automation_rules(priority DESC);

-- Automation executions indexes
CREATE INDEX IF NOT EXISTS idx_executions_rule_id ON automation_executions(rule_id);
CREATE INDEX IF NOT EXISTS idx_executions_lead_id ON automation_executions(lead_id);
CREATE INDEX IF NOT EXISTS idx_executions_followup_id ON automation_executions(followup_id) WHERE followup_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_executions_status ON automation_executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_scheduled_for ON automation_executions(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_executions_created_at ON automation_executions(created_at);

-- Composite index for finding pending executions
CREATE INDEX IF NOT EXISTS idx_executions_pending ON automation_executions(status, scheduled_for)
WHERE status IN ('pending', 'scheduled');

-- Automation metrics indexes
CREATE INDEX IF NOT EXISTS idx_metrics_rule_id ON automation_metrics(rule_id);
CREATE INDEX IF NOT EXISTS idx_metrics_date ON automation_metrics(date);

-- ============================================================================
-- DEFAULT AUTOMATION RULES
-- ============================================================================

-- Thinking follow-up (24h)
INSERT INTO automation_rules (
    id,
    account_id,
    name,
    description,
    rule_type,
    trigger_condition,
    delay_hours,
    max_attempts,
    message_template,
    include_calendly_link,
    active,
    priority
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Thinking Follow-up 24h',
    'Follow up with leads who said they need to think about it',
    'thinking_followup',
    '{"lead_state": "thinking"}',
    24,
    1,
    'היי! רציתי לבדוק אם חשבת על זה 🙂 אשמח לענות על שאלות נוספות. אם נוח לך, הנה לינק לקביעת שיעור ניסיון:',
    true,
    true,
    80
)
ON CONFLICT DO NOTHING;

-- Idle follow-up (48h)
INSERT INTO automation_rules (
    id,
    account_id,
    name,
    description,
    rule_type,
    trigger_condition,
    delay_hours,
    max_attempts,
    message_template,
    include_calendly_link,
    active,
    priority
)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'Idle Follow-up 48h',
    'Follow up with engaged leads who stopped responding',
    'idle_followup',
    '{"lead_state": "engaged", "idle_hours": 48}',
    48,
    1,
    'היי! לא שמעתי ממך 🙂 עדיין רלוונטי? אם יש שאלות, אשמח לעזור.',
    true,
    true,
    60
)
ON CONFLICT DO NOTHING;

-- Trial reminder (2h before)
INSERT INTO automation_rules (
    id,
    account_id,
    name,
    description,
    rule_type,
    trigger_condition,
    delay_hours,
    delay_minutes,
    max_attempts,
    message_template,
    include_calendly_link,
    active,
    priority
)
VALUES (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'Trial Reminder 2h',
    'Reminder 2 hours before scheduled trial lesson',
    'trial_reminder',
    '{"lead_state": "trial_scheduled"}',
    2,
    0,
    1,
    'תזכורת: יש לנו שיעור ניסיון עוד שעתיים! 📚 מחכה לך בזום.',
    false,
    true,
    100
)
ON CONFLICT DO NOTHING;

-- Trial follow-up (24h after)
INSERT INTO automation_rules (
    id,
    account_id,
    name,
    description,
    rule_type,
    trigger_condition,
    delay_hours,
    max_attempts,
    message_template,
    include_calendly_link,
    active,
    priority
)
VALUES (
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    'Trial Follow-up 24h',
    'Follow up 24 hours after trial lesson',
    'trial_followup',
    '{"trial_completed": true}',
    24,
    1,
    'היי! נהניתי מהשיעור אתמול 🙂 מה דעתך, נמשיך? אפשר לקבוע סדרה קבועה או שיעור נוסף.',
    true,
    true,
    90
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to get applicable rules for a lead
CREATE OR REPLACE FUNCTION get_applicable_rules(
    p_lead_id UUID,
    p_lead_state VARCHAR,
    p_agent_id UUID DEFAULT NULL
)
RETURNS TABLE (
    rule_id UUID,
    rule_name VARCHAR,
    rule_type VARCHAR,
    delay_hours INTEGER,
    priority INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ar.id as rule_id,
        ar.name as rule_name,
        ar.rule_type,
        ar.delay_hours,
        ar.priority
    FROM automation_rules ar
    JOIN leads l ON l.id = p_lead_id
    JOIN agents a ON a.id = COALESCE(p_agent_id, l.agent_id)
    WHERE ar.active = true
      AND ar.account_id = a.account_id
      AND (ar.agent_id IS NULL OR ar.agent_id = a.id)
      AND (
          ar.trigger_condition->>'lead_state' IS NULL
          OR ar.trigger_condition->>'lead_state' = p_lead_state
      )
    ORDER BY ar.priority DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Active rules summary
CREATE OR REPLACE VIEW v_active_rules_summary AS
SELECT
    ar.id,
    ar.name,
    ar.rule_type,
    ar.delay_hours,
    ar.max_attempts,
    ar.priority,
    a.name as account_name,
    ag.name as agent_name,
    COUNT(ae.id) FILTER (WHERE ae.status = 'sent') as total_sent,
    COUNT(ae.id) FILTER (WHERE ae.user_responded = true) as total_responses,
    CASE
        WHEN COUNT(ae.id) FILTER (WHERE ae.status = 'sent') > 0
        THEN ROUND(
            COUNT(ae.id) FILTER (WHERE ae.user_responded = true)::DECIMAL /
            COUNT(ae.id) FILTER (WHERE ae.status = 'sent') * 100, 2
        )
        ELSE 0
    END as response_rate_pct
FROM automation_rules ar
JOIN accounts a ON a.id = ar.account_id
LEFT JOIN agents ag ON ag.id = ar.agent_id
LEFT JOIN automation_executions ae ON ae.rule_id = ar.id
WHERE ar.active = true
GROUP BY ar.id, ar.name, ar.rule_type, ar.delay_hours, ar.max_attempts, ar.priority, a.name, ag.name;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE automation_rules IS 'Configurable automation rules for follow-ups and triggers';
COMMENT ON TABLE automation_executions IS 'Execution history and status of automation rules';
COMMENT ON TABLE automation_metrics IS 'Daily aggregated metrics for automation performance';
COMMENT ON COLUMN automation_rules.trigger_condition IS 'JSON conditions that must be met to trigger this rule';
COMMENT ON COLUMN automation_rules.message_variants IS 'JSON array of message variants for A/B testing';
COMMENT ON COLUMN automation_rules.send_window_start IS 'Earliest time of day to send messages (respects timezone)';
COMMENT ON COLUMN automation_rules.send_window_end IS 'Latest time of day to send messages (respects timezone)';

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

-- Automation rules trigger
DROP TRIGGER IF EXISTS update_automation_rules_updated_at ON automation_rules;
CREATE TRIGGER update_automation_rules_updated_at
    BEFORE UPDATE ON automation_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Automation metrics trigger
DROP TRIGGER IF EXISTS update_automation_metrics_updated_at ON automation_metrics;
CREATE TRIGGER update_automation_metrics_updated_at
    BEFORE UPDATE ON automation_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
