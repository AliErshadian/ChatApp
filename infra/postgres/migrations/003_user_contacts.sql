CREATE TABLE user_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, contact_user_id),
    CONSTRAINT no_self_contact CHECK (user_id != contact_user_id)
);

CREATE INDEX idx_user_contacts_user ON user_contacts (user_id);

GRANT ALL PRIVILEGES ON TABLE user_contacts TO chatapp;
