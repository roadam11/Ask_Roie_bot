# Ask ROIE Dashboard - Complete Specification

## Information Architecture (IA)

```
Dashboard
├── Module 1: Command Center (Overview)
│   ├── KPI Cards
│   │   ├── Active Leads (count + trend)
│   │   ├── Conversion Rate (% + change)
│   │   ├── Pipeline Value (₪ + forecast)
│   │   └── Avg Time to Book (hours)
│   ├── AI Performance Snapshot [NEW]
│   │   ├── AI Handled % (conversations without human)
│   │   ├── Human Takeover % (escalations)
│   │   ├── AI Success Rate (AI-only closures)
│   │   └── Avg Confidence Score
│   ├── Alerts Feed [NEW]
│   │   ├── Pending Approvals (requires action)
│   │   ├── Stuck Conversations (>24h no response)
│   │   ├── Failed Follow-ups (delivery failures)
│   │   ├── Low Confidence Responses (manual review)
│   │   └── Quota Warnings (approaching limits)
│   ├── Mini Sales Funnel
│   └── Recent Activity Feed
│
├── Module 2: Lead Pipeline
│   ├── Kanban Board View
│   │   ├── Columns: New → Qualified → Considering → Ready → Booked → Lost
│   │   ├── Drag-and-drop state changes
│   │   └── Card: name, subject, time in stage, confidence badge
│   ├── List View
│   │   ├── Sortable columns
│   │   ├── Inline editing
│   │   └── Bulk actions
│   └── Lead Detail Drawer
│       ├── Profile & Contact
│       ├── Qualification Data
│       ├── Conversation Thread
│       ├── Follow-up History
│       └── Manual Reply Composer
│
├── Module 3: Follow-up Center
│   ├── Scheduled Queue
│   │   ├── Calendar view (day/week)
│   │   ├── List view with filters
│   │   └── Drag to reschedule
│   ├── Execution Log
│   │   ├── Sent/Delivered/Failed status
│   │   ├── Response tracking
│   │   └── Retry management
│   └── Automation Rules
│       ├── Rule library (built-in + custom)
│       ├── Rule editor with conditions
│       ├── A/B test configuration
│       └── Performance metrics per rule
│
├── Module 4: AI Console
│   ├── Live Monitor
│   │   ├── Real-time conversation stream
│   │   ├── Intent classification badges
│   │   └── Confidence indicators
│   ├── Enhanced Telemetry [UPDATED]
│   │   ├── Decision Path: step-by-step reasoning visualization
│   │   ├── Rule Triggered: which automation rule fired
│   │   ├── Entities Extracted: subject, grade, format, urgency
│   │   ├── Timeline View: visual flow of conversation turns
│   │   └── Tool Usage: which tools were called and results
│   ├── Prompt Lab
│   │   ├── Version history
│   │   ├── A/B test results
│   │   └── Performance comparison
│   └── Debug Console
│       ├── Token usage graphs
│       ├── Latency metrics
│       └── Error logs
│
├── Module 5: Settings
│   ├── Account Settings
│   ├── User Management
│   ├── Agent Configuration
│   ├── Integration Settings
│   └── Notification Preferences
│
├── Module 6: Analytics [NEW]
│   ├── Conversion Analysis
│   │   ├── Segment Performance Table
│   │   │   ├── Group by: Subject, Source, Grade, Time Period
│   │   │   ├── Metrics: Leads, Conversions, Rate, Avg Value
│   │   │   └── Sortable, exportable
│   │   ├── Best Performers Chart
│   │   │   └── Top 10 segments by conversion rate
│   │   └── Trend Lines
│   │       └── Conversion rate over time per segment
│   │
│   ├── Funnel Deep Dive
│   │   ├── Stage Duration Analysis
│   │   │   ├── Avg time in each stage (hours/days)
│   │   │   ├── Distribution histogram per stage
│   │   │   └── Outlier detection
│   │   ├── Drop-off Analysis
│   │   │   ├── % lost at each stage
│   │   │   ├── Sankey diagram visualization
│   │   │   └── Lost reason breakdown
│   │   ├── Bottleneck Detection
│   │   │   ├── Stages with <70% conversion (red alert)
│   │   │   ├── Recommendations engine
│   │   │   └── Historical comparison
│   │   └── Win Rate Trends
│   │       ├── Weekly/monthly win rate
│   │       └── Cohort comparison
│   │
│   ├── AI Performance Analytics
│   │   ├── Intent Success Matrix
│   │   │   ├── Success rate by detected intent
│   │   │   ├── Heatmap: intent × outcome
│   │   │   └── Drill-down to conversations
│   │   ├── Confidence Analysis
│   │   │   ├── Confidence vs Conversion scatter plot
│   │   │   ├── Optimal confidence threshold finder
│   │   │   └── Low-confidence review queue
│   │   ├── AI vs Human Comparison
│   │   │   ├── Close rate: AI-only vs human-assisted
│   │   │   ├── Time to close comparison
│   │   │   └── Quality score comparison
│   │   ├── Fallback Analysis
│   │   │   ├── Why AI failed (intent, confidence, edge case)
│   │   │   ├── Common failure patterns
│   │   │   └── Training data suggestions
│   │   └── Tool Usage Stats
│   │       ├── Tool call frequency
│   │       ├── Success rate per tool
│   │       └── Performance impact
│   │
│   └── Revenue Intelligence
│       ├── Value Distribution
│       │   ├── Lead value histogram
│       │   ├── Quartile breakdown
│       │   └── High-value lead identification
│       ├── Pipeline Velocity
│       │   ├── Days from new → booked
│       │   ├── Velocity by segment
│       │   └── Acceleration/deceleration trends
│       ├── Revenue Forecast
│       │   ├── Expected revenue = Σ(probability × value)
│       │   ├── Confidence intervals
│       │   └── Monthly projections
│       └── Cohort Analysis
│           ├── Revenue by acquisition month
│           ├── LTV curves
│           └── Retention analysis
│
└── Module 7: Conversations [NEW]
    ├── Search & Filter
    │   ├── Full-text Search
    │   │   ├── Search across all message content
    │   │   ├── Highlight matches in results
    │   │   └── Search suggestions
    │   ├── Advanced Filters
    │   │   ├── Keyword (exact, contains, regex)
    │   │   ├── Intent (dropdown multi-select)
    │   │   ├── Lead State (funnel stage)
    │   │   ├── Confidence Range (slider)
    │   │   ├── Date Range (picker)
    │   │   ├── Platform (WhatsApp/Telegram)
    │   │   ├── Outcome (booked/lost/pending)
    │   │   └── Has Flag (QA flagged)
    │   └── Sort Options
    │       ├── Relevance (search score)
    │       ├── Date (newest/oldest)
    │       ├── Confidence (high/low)
    │       └── Message Count
    │
    ├── Conversation Browser
    │   ├── List View
    │   │   ├── Thumbnail: lead name, last message preview
    │   │   ├── Badges: intent, confidence %, outcome
    │   │   ├── Metadata: date, platform, message count
    │   │   └── Expandable preview
    │   ├── Conversation Detail
    │   │   ├── Full message thread
    │   │   ├── Message-level telemetry (intent, confidence)
    │   │   ├── AI reasoning for each response
    │   │   └── Timeline markers (stage changes, tool calls)
    │   └── Quick Actions
    │       ├── View full conversation
    │       ├── Flag for review
    │       ├── Export transcript
    │       ├── Jump to lead profile
    │       └── Replay in sandbox
    │
    └── QA Dashboard
        ├── Quality Metrics
        │   ├── Avg response quality score
        │   ├── User satisfaction distribution
        │   ├── Response time compliance
        │   └── Hallucination detection rate
        ├── Flagged Conversations
        │   ├── Manual flags (by team)
        │   ├── Auto-flags (low confidence, errors)
        │   ├── Review workflow
        │   └── Resolution tracking
        ├── Failure Patterns
        │   ├── Common error categories
        │   ├── Edge case collection
        │   ├── Frequency and impact
        │   └── Root cause tags
        ├── A/B Testing Results
        │   ├── Active experiments
        │   ├── Prompt version comparison
        │   ├── Statistical significance
        │   └── Winner selection
        └── Training Data Export
            ├── Export formats (JSONL, CSV)
            ├── Filters for quality data
            ├── Annotation interface
            └── Fine-tuning dataset builder
```

---

## Data Structure

### New Tables Required

#### 1. `conversation_search` (Full-Text Search Index)

```sql
CREATE TABLE conversation_search (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,

    -- Searchable content
    content_text TEXT NOT NULL,  -- Concatenated message content
    content_tsvector TSVECTOR,   -- PostgreSQL full-text search vector

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
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- GIN index for full-text search
CREATE INDEX idx_conversation_search_tsvector
    ON conversation_search USING GIN(content_tsvector);
```

#### 2. `qa_flags` (Quality Assurance Flags)

```sql
CREATE TABLE qa_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,

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
    resolved_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP,

    -- Metadata
    flagged_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,

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
```

#### 3. `analytics_snapshots` (Pre-computed Analytics)

```sql
CREATE TABLE analytics_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,

    -- Snapshot period
    period_type VARCHAR(20) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    -- Conversion metrics by segment (JSONB for flexibility)
    conversion_by_subject JSONB DEFAULT '{}',
    conversion_by_source JSONB DEFAULT '{}',
    conversion_by_grade JSONB DEFAULT '{}',
    conversion_by_hour JSONB DEFAULT '{}',

    -- Funnel metrics
    funnel_stages JSONB DEFAULT '{}',
    stage_durations JSONB DEFAULT '{}',
    dropoff_rates JSONB DEFAULT '{}',
    bottlenecks JSONB DEFAULT '[]',

    -- AI performance
    ai_performance JSONB DEFAULT '{}',
    intent_success_rates JSONB DEFAULT '{}',
    confidence_distribution JSONB DEFAULT '{}',
    tool_usage_stats JSONB DEFAULT '{}',

    -- Revenue metrics
    revenue_metrics JSONB DEFAULT '{}',
    pipeline_velocity JSONB DEFAULT '{}',
    value_distribution JSONB DEFAULT '{}',

    -- Metadata
    computed_at TIMESTAMP DEFAULT NOW() NOT NULL,
    computation_time_ms INTEGER,

    CONSTRAINT chk_snapshots_period_type CHECK (
        period_type IN ('daily', 'weekly', 'monthly', 'quarterly')
    ),
    CONSTRAINT uq_snapshots_unique UNIQUE (account_id, agent_id, period_type, period_start)
);
```

#### 4. `alerts` (System Alerts)

```sql
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,

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
    acknowledged_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMP,
    resolved_at TIMESTAMP,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMP,

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
```

#### 5. Enhanced `ai_telemetry` Columns

```sql
-- Add new columns to ai_telemetry
ALTER TABLE ai_telemetry
ADD COLUMN IF NOT EXISTS decision_path JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS rule_triggered_id UUID REFERENCES automation_rules(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS entities_extracted JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS conversation_turn INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS is_fallback BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS fallback_reason VARCHAR(100),
ADD COLUMN IF NOT EXISTS human_takeover BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS takeover_reason VARCHAR(100);

-- Add constraint for fallback reasons
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
```

---

### Enhanced JSONB Structures

#### `decision_path` Structure
```json
{
  "steps": [
    {
      "step": 1,
      "type": "intent_classification",
      "input": "אני צריך עזרה במתמטיקה",
      "output": "inquiry",
      "confidence": 0.92,
      "duration_ms": 45
    },
    {
      "step": 2,
      "type": "entity_extraction",
      "entities": {
        "subject": "מתמטיקה",
        "urgency": null
      },
      "duration_ms": 32
    },
    {
      "step": 3,
      "type": "rule_evaluation",
      "rules_checked": ["qualification_flow", "greeting_response"],
      "rule_selected": "qualification_flow",
      "reason": "Missing qualification data"
    },
    {
      "step": 4,
      "type": "response_generation",
      "template_used": "ask_grade_level",
      "personalization_applied": true,
      "duration_ms": 156
    },
    {
      "step": 5,
      "type": "tool_call",
      "tool": "update_lead_state",
      "input": {"new_state": "engaged"},
      "success": true
    }
  ],
  "total_duration_ms": 289,
  "final_confidence": 0.89
}
```

#### `entities_extracted` Structure
```json
{
  "subject": {
    "value": "מתמטיקה",
    "confidence": 0.95,
    "source": "explicit_mention"
  },
  "grade": {
    "value": "כיתה י",
    "confidence": 0.88,
    "source": "inferred"
  },
  "format_preference": {
    "value": "online",
    "confidence": 0.72,
    "source": "context"
  },
  "urgency": {
    "value": "high",
    "confidence": 0.65,
    "source": "temporal_reference",
    "reference": "לפני המבחן בעוד שבוע"
  },
  "budget_mentioned": false,
  "competitor_mentioned": false,
  "referral_source": null
}
```

#### `analytics_snapshots.ai_performance` Structure
```json
{
  "total_conversations": 450,
  "ai_handled_only": 380,
  "ai_handled_pct": 84.4,
  "human_takeover": 70,
  "human_takeover_pct": 15.6,
  "ai_success_rate": 78.2,
  "avg_confidence": 0.847,
  "avg_response_time_ms": 1250,
  "total_tokens": 125000,
  "total_cost_usd": 8.45,
  "intent_accuracy": {
    "verified_correct": 412,
    "verified_incorrect": 38,
    "accuracy_pct": 91.6
  }
}
```

#### `analytics_snapshots.funnel_stages` Structure
```json
{
  "stages": [
    {
      "name": "new",
      "count": 100,
      "conversion_to_next": 72.0,
      "avg_duration_hours": 2.5,
      "median_duration_hours": 1.8,
      "dropoff_count": 28,
      "dropoff_reasons": {
        "no_response": 15,
        "not_interested": 8,
        "wrong_service": 5
      }
    },
    {
      "name": "qualified",
      "count": 72,
      "conversion_to_next": 68.0,
      "avg_duration_hours": 18.3,
      "is_bottleneck": true,
      "bottleneck_severity": "medium"
    }
  ],
  "overall_conversion": 28.0,
  "avg_time_to_close_hours": 52.4
}
```

---

### Indexes for New Tables

```sql
-- conversation_search indexes
CREATE INDEX idx_conv_search_conversation_id ON conversation_search(conversation_id);
CREATE INDEX idx_conv_search_lead_id ON conversation_search(lead_id);
CREATE INDEX idx_conv_search_agent_id ON conversation_search(agent_id);
CREATE INDEX idx_conv_search_platform ON conversation_search(platform);
CREATE INDEX idx_conv_search_intent ON conversation_search(primary_intent);
CREATE INDEX idx_conv_search_outcome ON conversation_search(outcome);
CREATE INDEX idx_conv_search_dates ON conversation_search(first_message_at, last_message_at);

-- qa_flags indexes
CREATE INDEX idx_qa_flags_conversation_id ON qa_flags(conversation_id);
CREATE INDEX idx_qa_flags_status ON qa_flags(status) WHERE status = 'open';
CREATE INDEX idx_qa_flags_type ON qa_flags(flag_type);
CREATE INDEX idx_qa_flags_severity ON qa_flags(severity);
CREATE INDEX idx_qa_flags_created_at ON qa_flags(created_at);

-- analytics_snapshots indexes
CREATE INDEX idx_analytics_account_period ON analytics_snapshots(account_id, period_type, period_start);
CREATE INDEX idx_analytics_computed_at ON analytics_snapshots(computed_at);

-- alerts indexes
CREATE INDEX idx_alerts_account_id ON alerts(account_id);
CREATE INDEX idx_alerts_status ON alerts(status) WHERE status = 'active';
CREATE INDEX idx_alerts_type ON alerts(alert_type);
CREATE INDEX idx_alerts_severity ON alerts(severity);
CREATE INDEX idx_alerts_action ON alerts(action_required) WHERE action_required = true;
CREATE INDEX idx_alerts_created_at ON alerts(created_at);

-- ai_telemetry new column indexes
CREATE INDEX idx_telemetry_rule_triggered ON ai_telemetry(rule_triggered_id) WHERE rule_triggered_id IS NOT NULL;
CREATE INDEX idx_telemetry_is_fallback ON ai_telemetry(is_fallback) WHERE is_fallback = true;
CREATE INDEX idx_telemetry_human_takeover ON ai_telemetry(human_takeover) WHERE human_takeover = true;
CREATE INDEX idx_telemetry_conversation_turn ON ai_telemetry(conversation_id, conversation_turn);
```

---

## API Endpoints (New)

### Module 6: Analytics

```
GET  /api/analytics/conversion
     ?groupBy=subject|source|grade|hour|day|week
     ?dateFrom=2026-01-01
     ?dateTo=2026-02-26
     ?agentId=uuid

GET  /api/analytics/funnel
     ?dateFrom=2026-01-01
     ?dateTo=2026-02-26
     ?includeDropoff=true
     ?includeDurations=true

GET  /api/analytics/funnel/bottlenecks
     ?threshold=70

GET  /api/analytics/ai-performance
     ?dateFrom=2026-01-01
     ?dateTo=2026-02-26
     ?includeIntents=true

GET  /api/analytics/ai-performance/confidence
     ?buckets=10

GET  /api/analytics/revenue
     ?dateFrom=2026-01-01
     ?dateTo=2026-02-26
     ?includeForecast=true

GET  /api/analytics/revenue/cohorts
     ?cohortBy=month
     ?metric=ltv|retention

GET  /api/analytics/export
     ?type=conversion|funnel|ai|revenue
     ?format=csv|xlsx|json
```

### Module 7: Conversations

```
GET  /api/conversations/search
     ?q=search_text
     ?intent=greeting,inquiry
     ?state=qualified,considering
     ?confidenceMin=0.5
     ?confidenceMax=1.0
     ?dateFrom=2026-01-01
     ?dateTo=2026-02-26
     ?platform=whatsapp
     ?outcome=booked
     ?hasFlagged=true
     ?page=1
     &limit=20
     &sort=relevance|date|confidence

GET  /api/conversations/:id
     ?includeMessages=true
     ?includeTelemetry=true
     ?includeTimeline=true

GET  /api/conversations/:id/timeline

POST /api/conversations/:id/flag
     body: { flagType, severity, reason }

GET  /api/conversations/qa/dashboard
     ?dateFrom=2026-01-01
     ?dateTo=2026-02-26

GET  /api/conversations/qa/flags
     ?status=open
     ?severity=high,critical
     ?page=1
     &limit=20

PUT  /api/conversations/qa/flags/:id
     body: { status, resolutionNotes }

GET  /api/conversations/qa/patterns
     ?limit=10

GET  /api/conversations/qa/ab-tests
     ?status=active

POST /api/conversations/export
     body: {
       filters: {...},
       format: 'jsonl'|'csv',
       includeAnnotations: true
     }
```

### Enhanced Overview

```
GET  /api/dashboard/ai-snapshot
     → Returns AI performance summary for command center

GET  /api/dashboard/alerts
     ?status=active
     ?actionRequired=true
     ?limit=10

PUT  /api/dashboard/alerts/:id/acknowledge

PUT  /api/dashboard/alerts/:id/resolve
```

---

## Views for Analytics

```sql
-- Real-time AI performance snapshot
CREATE OR REPLACE VIEW v_ai_performance_snapshot AS
SELECT
    agent_id,
    COUNT(*) as total_conversations,
    COUNT(*) FILTER (WHERE NOT human_takeover) as ai_only,
    COUNT(*) FILTER (WHERE human_takeover) as human_assisted,
    ROUND(100.0 * COUNT(*) FILTER (WHERE NOT human_takeover) / NULLIF(COUNT(*), 0), 1) as ai_handled_pct,
    COUNT(*) FILTER (WHERE NOT human_takeover AND detected_intent = 'booking_confirm') as ai_bookings,
    ROUND(AVG(intent_confidence) * 100, 1) as avg_confidence,
    ROUND(AVG(latency_ms)) as avg_latency_ms,
    SUM(total_tokens) as total_tokens
FROM ai_telemetry
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY agent_id;

-- Conversion by segment (materialized for performance)
CREATE MATERIALIZED VIEW mv_conversion_by_segment AS
SELECT
    l.agent_id,
    DATE_TRUNC('week', l.created_at) as week,
    l.subject,
    l.education_level,
    COUNT(*) as total_leads,
    COUNT(*) FILTER (WHERE l.status = 'booked') as booked,
    ROUND(100.0 * COUNT(*) FILTER (WHERE l.status = 'booked') / NULLIF(COUNT(*), 0), 2) as conversion_rate,
    ROUND(AVG(l.lead_value), 2) as avg_value
FROM leads l
WHERE l.created_at > NOW() - INTERVAL '90 days'
GROUP BY l.agent_id, DATE_TRUNC('week', l.created_at), l.subject, l.education_level;

-- Refresh daily
-- REFRESH MATERIALIZED VIEW mv_conversion_by_segment;

-- Funnel stage analysis
CREATE OR REPLACE VIEW v_funnel_analysis AS
WITH stage_transitions AS (
    SELECT
        agent_id,
        status as stage,
        COUNT(*) as count,
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600) as avg_hours_in_stage
    FROM leads
    WHERE created_at > NOW() - INTERVAL '30 days'
    GROUP BY agent_id, status
),
stage_order AS (
    SELECT stage,
           CASE stage
               WHEN 'new' THEN 1
               WHEN 'qualified' THEN 2
               WHEN 'considering' THEN 3
               WHEN 'hesitant' THEN 4
               WHEN 'ready_to_book' THEN 5
               WHEN 'booked' THEN 6
               WHEN 'lost' THEN 7
           END as stage_num
    FROM (VALUES ('new'), ('qualified'), ('considering'), ('hesitant'), ('ready_to_book'), ('booked'), ('lost')) AS s(stage)
)
SELECT
    st.agent_id,
    st.stage,
    so.stage_num,
    st.count,
    st.avg_hours_in_stage,
    ROUND(100.0 * st.count / NULLIF(LAG(st.count) OVER (PARTITION BY st.agent_id ORDER BY so.stage_num), 0), 1) as conversion_from_prev
FROM stage_transitions st
JOIN stage_order so ON st.stage = so.stage
ORDER BY st.agent_id, so.stage_num;
```

---

## Background Jobs Required

### 1. Analytics Snapshot Job (Daily)
```typescript
// Runs at 2:00 AM daily
async function computeDailyAnalyticsSnapshot(accountId: string): Promise<void> {
  // Compute all analytics metrics
  // Store in analytics_snapshots table
  // Used for fast dashboard loading
}
```

### 2. Conversation Search Indexer (Real-time)
```typescript
// Triggered on new message
async function updateConversationSearchIndex(conversationId: string): Promise<void> {
  // Concatenate all messages
  // Update tsvector
  // Update denormalized fields
}
```

### 3. Alert Generator (Every 5 minutes)
```typescript
// Scans for alert conditions
async function generateAlerts(accountId: string): Promise<void> {
  // Check for stuck conversations (>24h)
  // Check for failed follow-ups
  // Check for low confidence responses
  // Check for quota warnings
  // Create alerts if conditions met
}
```

### 4. QA Auto-Flagger (Real-time)
```typescript
// Triggered on telemetry insert
async function autoFlagConversation(telemetryId: string): Promise<void> {
  // Check confidence < threshold
  // Check for error indicators
  // Check for policy violations
  // Create qa_flag if needed
}
```

---

## Migration Order

1. `007_add_analytics_tables.sql` - New analytics infrastructure
2. Run backfill job to populate `conversation_search` from existing data
3. Run initial analytics snapshot computation
