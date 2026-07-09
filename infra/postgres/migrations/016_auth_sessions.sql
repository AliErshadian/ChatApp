ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS session_family_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS client_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS platform VARCHAR(64),
  ADD COLUMN IF NOT EXISTS device_label VARCHAR(128),
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family
  ON refresh_tokens (user_id, session_family_id)
  WHERE revoked_at IS NULL;
