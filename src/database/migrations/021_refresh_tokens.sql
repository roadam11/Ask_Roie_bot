-- Migration 021: Refresh Token DB Tracking
-- Enables secure refresh token rotation.
-- Each refresh token is hashed (bcrypt) and stored.
-- On rotation: old token is revoked, new token inserted with replaced_by reference.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL,
  user_id         UUID NOT NULL,
  token_hash      TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  replaced_by     UUID REFERENCES refresh_tokens(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast token lookup at refresh time
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash
  ON refresh_tokens (token_hash);

-- Index for cleanup job: find all expired rows
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
  ON refresh_tokens (expires_at);

-- Index for audit: find all tokens per user
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
  ON refresh_tokens (user_id);
