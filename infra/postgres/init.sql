-- ChatApp production schema (PostgreSQL 16)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE conversation_type AS ENUM ('direct', 'channel', 'group');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE presence_status AS ENUM ('online', 'away', 'offline');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(128) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type conversation_type NOT NULL,
    name VARCHAR(128),
    description TEXT,
    avatar_url TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    pending_owner_id UUID REFERENCES users(id),
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT channel_requires_name CHECK (
        type = 'direct' OR (name IS NOT NULL AND length(trim(name)) > 0)
    )
);

CREATE TABLE conversation_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role member_role NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_read_at TIMESTAMPTZ,
    pinned_at TIMESTAMPTZ,
    UNIQUE (conversation_id, user_id)
);

CREATE INDEX idx_conversation_members_pinned
    ON conversation_members (user_id, pinned_at DESC NULLS LAST)
    WHERE pinned_at IS NOT NULL;

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    content_type VARCHAR(128) NOT NULL DEFAULT 'text/plain',
    file_name VARCHAR(255),
    file_size BIGINT,
    caption TEXT,
    client_message_id VARCHAR(64),
    sequence BIGINT GENERATED ALWAYS AS IDENTITY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    forwarded_from_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    original_sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    search_vector tsvector,
    CONSTRAINT content_not_empty CHECK (length(trim(content)) > 0)
);

CREATE INDEX idx_messages_search_vector
    ON messages USING GIN (search_vector);

CREATE UNIQUE INDEX idx_messages_client_dedup
    ON messages (conversation_id, sender_id, client_message_id)
    WHERE client_message_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_messages_conversation_sequence
    ON messages (conversation_id, sequence DESC);

CREATE INDEX idx_messages_conversation_created
    ON messages (conversation_id, created_at DESC);

CREATE INDEX idx_messages_reply_to
    ON messages (reply_to_message_id)
    WHERE reply_to_message_id IS NOT NULL;

CREATE INDEX idx_messages_forwarded_from
    ON messages (forwarded_from_message_id)
    WHERE forwarded_from_message_id IS NOT NULL;

CREATE TABLE message_read_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, user_id)
);

CREATE INDEX idx_read_receipts_message ON message_read_receipts (message_id);
CREATE INDEX idx_read_receipts_user ON message_read_receipts (user_id);

CREATE TABLE message_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, user_id)
);

CREATE INDEX idx_message_deliveries_message ON message_deliveries (message_id);

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    session_family_id UUID NOT NULL DEFAULT gen_random_uuid(),
    client_type VARCHAR(32),
    platform VARCHAR(64),
    device_label VARCHAR(128),
    user_agent TEXT,
    last_used_at TIMESTAMPTZ,
    ip_address VARCHAR(45),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens (expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (user_id, session_family_id) WHERE revoked_at IS NULL;

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_label VARCHAR(128) NOT NULL,
    app_name VARCHAR(64),
    client_type VARCHAR(32),
    platform VARCHAR(64),
    user_agent TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_user_sessions_user ON user_sessions (user_id) WHERE revoked_at IS NULL;

-- Direct conversations: enforce at most one DM per user pair via sorted member key
CREATE TABLE direct_conversation_pairs (
    conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    user_a UUID NOT NULL REFERENCES users(id),
    user_b UUID NOT NULL REFERENCES users(id),
    CONSTRAINT ordered_pair CHECK (user_a < user_b),
    UNIQUE (user_a, user_b)
);

CREATE TABLE user_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, contact_user_id),
    CONSTRAINT no_self_contact CHECK (user_id != contact_user_id)
);

CREATE INDEX idx_user_contacts_user ON user_contacts (user_id);

CREATE TABLE message_user_hidden (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, user_id)
);

CREATE INDEX idx_message_user_hidden_user ON message_user_hidden (user_id);

CREATE TABLE message_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX idx_message_reactions_message ON message_reactions (message_id);

CREATE TABLE message_mentions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, user_id)
);

CREATE INDEX idx_message_mentions_message ON message_mentions (message_id);
CREATE INDEX idx_message_mentions_user ON message_mentions (user_id);

CREATE TABLE conversation_user_hidden (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conversation_id, user_id)
);

CREATE INDEX idx_conversation_user_hidden_user ON conversation_user_hidden (user_id);

CREATE TABLE channel_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_channel_invites_token ON channel_invites (token);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    resource_type VARCHAR(32),
    resource_id VARCHAR(64),
    metadata JSONB NOT NULL DEFAULT '{}',
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('simple', coalesce(NEW.content, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.caption, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(NEW.file_name, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_search_vector_trigger
    BEFORE INSERT OR UPDATE OF content, caption, file_name
    ON messages
    FOR EACH ROW
    EXECUTE FUNCTION messages_search_vector_update();

-- Fresh databases from init.sql are marked up-to-date for incremental migrations.
-- Checksums are verified in CI via: npm run check:schema-drift
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version, checksum) VALUES
    ('002_message_deliveries', '812f44c132cb7a7525e9cd3319b7f6460307eb353344306bad7e270bc18f4970'),
    ('003_user_contacts', '348852a142847a6f2e0dbeae974f44e5c19e7fc7cdab3059ecf3096d6461a2a1'),
    ('004_message_user_hidden', '7ebe0eae6af137b0698dd49978c505408337502d4e9f59ddc5434c9d722bb7d9'),
    ('005_message_reactions', '682b44d57a7b0cbabc4ab4015ba0b1fc52ec0ae77c69bca9bd9683630117cf2c'),
    ('006_conversation_user_hidden', '642082701b3d7866fb0b30c55564e0c6c73f51c8749475260e09d500b3243ef9'),
    ('007_channel_invites', '4a71210027bafd3232861900ca5bf0291b416b9050d319dc9774b5af56b034a9'),
    ('008_channel_pending_owner', '0dbcc59f83841ea88fa1feb3a5d0486509f44d33f9345aa3c0f095c9510c4e90'),
    ('009_channel_avatar', 'e8c8db5640e862cb96023b3ed1ee8f6b1c926c7104ac470f5ec7b6f492735e06'),
    ('010_message_reply', '2396e838b89cb28af284f7dbb0f669314d963e5864e94357dd6cc6878bee33e5'),
    ('011_groups', '156187a720f932e9dd555a1826c3f9360027fa7e0cb12bb405b7324d8eeb3812'),
    ('012_message_attachments', '27d2ac61882c1c0cf41c30cd5a1c636e9810cdbe4b863bd80a612ca3dd2a23b7'),
    ('013_conversation_pin', 'ae79ca732f28fa16936624bd4c78333a3493a8be6b0595a1f21f67ab779a3370'),
    ('014_message_forward', 'a55637b03817ec8cc45693d30f2477948164806904270dc2c7dd1faa748913c1'),
    ('015_message_mentions', '910b2e00292cd44a66e6796f396c760515f499e7c8bd6edf9ad00339c15eded0'),
    ('016_auth_sessions', '37059a25b60e137052edf9e62430f6a6a1ec2c67ec8f5bcff1d88de5acd0575b'),
    ('017_user_sessions', 'fa940dc5c7e69af9a88e9be87f9109397c8879060a6a16d4c1f2733be3ea6ec8'),
    ('018_admin_users', '93672caca7921903b51eda39d173aaaff5efc1d5761a88824e8de334e635ab99'),
    ('019_audit_logs', '899647e5c1d547d7226a40941577477b4a8e87d01c4f5b4f46cc5d2a68f10ef5'),
    ('020_message_search_fts', '6c1c7345747dfcd01c815aee97bc4a43114927fa8a93ddad7c819d69daa5a6c1')
ON CONFLICT (version) DO NOTHING;

-- Grant app user access (required when schema is created by postgres superuser)
GRANT USAGE ON SCHEMA public TO chatapp;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO chatapp;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO chatapp;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO chatapp;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO chatapp;
