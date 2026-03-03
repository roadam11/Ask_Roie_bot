-- ============================================================================
-- 014_message_response_time.sql
-- Sprint 4.4a — Add response_time_ms to messages for AI telemetry display
-- ============================================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS response_time_ms INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_calls_used TEXT[];
