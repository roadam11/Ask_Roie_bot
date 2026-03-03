-- Migration 011: Audit Log System
-- Tracks all data-modifying operations with before/after snapshots

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  user_id UUID,  -- NULL for system/webhook actions
  request_id VARCHAR(255),
  action VARCHAR(50) NOT NULL,  -- 'lead.updated', 'lead.deleted', 'settings.updated', etc.
  entity_type VARCHAR(50) NOT NULL,  -- 'lead', 'conversation', 'settings', 'knowledge'
  entity_id VARCHAR(255),  -- UUID or identifier of the affected entity
  before_data JSONB,  -- snapshot before change (NULL for creates)
  after_data JSONB,   -- snapshot after change (NULL for deletes)
  metadata JSONB,     -- extra context (IP, route, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_account ON audit_logs (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
