-- Webhook deduplication table
-- Tracks processed webhook events to prevent duplicate processing.
-- Uses INSERT ... ON CONFLICT DO NOTHING for atomic check-and-insert.
-- Old entries can be cleaned up after 7 days (retries only happen within minutes).

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(20) NOT NULL,    -- 'whatsapp' | 'telegram'
  event_id VARCHAR(255) NOT NULL,   -- message ID from provider (wamid.xxx or update_id)
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_webhook_event UNIQUE (provider, event_id)
);

-- Index for TTL cleanup queries (DELETE WHERE processed_at < NOW() - INTERVAL '7 days')
CREATE INDEX idx_webhook_events_processed_at ON processed_webhook_events (processed_at);
