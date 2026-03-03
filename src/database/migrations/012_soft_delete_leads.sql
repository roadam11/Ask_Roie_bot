-- Migration 012: Soft delete for leads
-- Instead of permanently deleting leads, we set deleted_at timestamp.
-- All queries must filter by deleted_at IS NULL to exclude soft-deleted leads.

-- Add deleted_at column for soft delete
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index for filtering active leads efficiently (most queries)
CREATE INDEX IF NOT EXISTS idx_leads_deleted_at ON leads (deleted_at) WHERE deleted_at IS NULL;

-- Index for finding deleted leads (admin restore)
CREATE INDEX IF NOT EXISTS idx_leads_deleted ON leads (deleted_at) WHERE deleted_at IS NOT NULL;
