UPDATE call_records
SET callee_seen_at = COALESCE(ended_at, NOW())
WHERE callee_seen_at IS NULL;
