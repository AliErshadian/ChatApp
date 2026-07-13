ALTER TABLE call_records ADD COLUMN IF NOT EXISTS callee_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_call_records_callee_unseen_missed
  ON call_records (callee_id, ended_at DESC)
  WHERE answered_at IS NULL AND callee_seen_at IS NULL;
