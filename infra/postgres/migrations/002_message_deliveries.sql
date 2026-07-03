-- Run on existing databases that already have init.sql applied
CREATE TABLE IF NOT EXISTS message_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_message ON message_deliveries (message_id);
