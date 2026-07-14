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
    thread_root_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    reply_count INTEGER NOT NULL DEFAULT 0,
    latest_reply_at TIMESTAMPTZ,
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

CREATE INDEX idx_messages_thread_root
    ON messages (thread_root_id, sequence ASC)
    WHERE thread_root_id IS NOT NULL;

CREATE INDEX idx_messages_conversation_main
    ON messages (conversation_id, sequence DESC)
    WHERE thread_root_id IS NULL;

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

CREATE TABLE message_thread_reads (
    thread_root_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (thread_root_id, user_id)
);

CREATE INDEX idx_message_thread_reads_user
    ON message_thread_reads (user_id, last_read_at DESC);

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

CREATE TABLE attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_name VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    bucket VARCHAR(128) NOT NULL,
    object_key TEXT NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    extension VARCHAR(32) NOT NULL,
    size BIGINT NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    url TEXT NOT NULL,
    uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_by ON attachments(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_attachments_conversation_id ON attachments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);

CREATE TABLE call_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL UNIQUE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    caller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    callee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    end_reason TEXT NOT NULL,
    ended_by UUID REFERENCES users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL,
    answered_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ NOT NULL,
    duration_seconds INTEGER,
    media_type TEXT NOT NULL DEFAULT 'audio',
    callee_seen_at TIMESTAMPTZ
);

CREATE INDEX idx_call_records_caller_ended ON call_records (caller_id, ended_at DESC);
CREATE INDEX idx_call_records_callee_ended ON call_records (callee_id, ended_at DESC);
CREATE INDEX idx_call_records_conversation ON call_records (conversation_id);
CREATE INDEX idx_call_records_callee_unseen_missed
  ON call_records (callee_id, ended_at DESC)
  WHERE answered_at IS NULL AND callee_seen_at IS NULL;

-- Fresh databases from init.sql are marked up-to-date for incremental migrations.
-- Checksums are verified in CI via: npm run check:schema-drift
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version, checksum) VALUES
    ('002_message_deliveries', '717412c9702a36da4e4b7be220a610c3c90b98247b29e27e97bee2e7a371d774'),
    ('003_user_contacts', '79881c9764b689a33155239a4d267353e9897ae9df4c5f4a43c44da579f3fb47'),
    ('004_message_user_hidden', '49f34e6056ebbb46dab86034f79adb627b9bd94ecd6651db93d73f6ea86bf20d'),
    ('005_message_reactions', '874ddd95c4340cd769b5efb003293fc175df211c31b17a5584590487df1b9812'),
    ('006_conversation_user_hidden', 'a7078cc0bb1b788192cc60dbae56d37f769a745f1b66ccc9f262e037fdcdb90b'),
    ('007_channel_invites', '8004af1cffb3f2764b760c965ad37ed03cb68a431d4b90937e267d451585caaa'),
    ('008_channel_pending_owner', '05f3675ea75953e9615ffc91608e77976c656cf8f1e2c3b8350b6f696823b886'),
    ('009_channel_avatar', 'bd1df68520319937e0e21e5881745796dc723da2e2207c903ffecc06f1e13cff'),
    ('010_message_reply', '682a1e6af9a267c5fe09536dacdb6ab6170591f9c8fc2a518481e57e763f07b9'),
    ('011_groups', '1b33cf1728e009786d2d61e7938cd4f8194a422866ac87d3cbb8edbed85d7b23'),
    ('012_message_attachments', 'c87ea973e538b39bcb05a2d62e4564febd4862342e7ac4cb5cea61fab4a49e07'),
    ('013_conversation_pin', '97537c8c4812839faab077bace9fd5802daa773e2da7ded87d3b9d926f9e69cb'),
    ('014_message_forward', '08f0c804a2b0e133d32ace4c4b0130856262e7b7440c1072eabbb2037075a14e'),
    ('015_message_mentions', 'c1c7b52bac565dd697a9ebc6dbc6f761fd766780a017e478dc637192573a4895'),
    ('016_auth_sessions', '7f4ee7915e7337bc788957296d785ea791bf8bacf84432c7835411a0613e36ea'),
    ('017_user_sessions', '2881b88ac0684d5794be7e74524593677432ed23ed03df9e1009c0dafd63bfcc'),
    ('018_admin_users', '10e5ca126e794c6ff1ba3baf63fbada86cd3555795a6a17ffc5591acb9a966c2'),
    ('019_audit_logs', 'e34adae3bcc2378a0340c325c951d6325bbd400433ced38dc4ead174187f0fd0'),
    ('020_message_search_fts', '6030984121e3713524e6cee3ba9f46d93645fc55aec323a0f83d9702192c39b7'),
    ('021_attachments', '02af4f9276bbd941ec3e49024e06d57ab69c79a16e4abcc29a45c461d6bbc3d7'),
    ('022_call_records', 'bf34a1adce6c90fa6873b276b503cee224b600f6021ae8c4d9c8a0de07c69c34'),
    ('023_call_media_type', '169bafa200b47d92cb5011b182b8f5ebce3f4ac61e005d53eae29b78ee0218a7'),
    ('024_call_records_callee_seen', '2c3ab63eceb1c61352fcedbc81fc1ebd6955a34013a4a53344cd7d4e3714e33d'),
    ('025_call_records_mark_existing_seen', '1a0e623a6e422b121404db109d9476c48d9bdf19e0b45ddf747190de9f848fec'),
    ('026_message_threads', '72bedc2f95598e29ec36262cf075da171e9267c101407144ed2cf20cbfb0f669'),
    ('027_message_thread_reads', '9a61e8893c2108fe7ce8f1c68eaaf64c5b0a8a97578c9065fd4100b25bb2ebba')
ON CONFLICT (version) DO NOTHING;

-- Grant app user access (required when schema is created by postgres superuser)
GRANT USAGE ON SCHEMA public TO chatapp;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO chatapp;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO chatapp;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO chatapp;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO chatapp;
