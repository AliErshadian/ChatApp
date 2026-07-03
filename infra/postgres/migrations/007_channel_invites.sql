CREATE TABLE channel_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_channel_invites_token ON channel_invites (token);

GRANT ALL PRIVILEGES ON TABLE channel_invites TO chatapp;
