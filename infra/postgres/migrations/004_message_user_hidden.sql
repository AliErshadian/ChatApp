CREATE TABLE message_user_hidden (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, user_id)
);

CREATE INDEX idx_message_user_hidden_user ON message_user_hidden (user_id);

GRANT ALL PRIVILEGES ON TABLE message_user_hidden TO chatapp;
