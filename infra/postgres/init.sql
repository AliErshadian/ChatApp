-- ChatApp production schema (PostgreSQL 16)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE conversation_type AS ENUM ('direct', 'channel', 'group');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE presence_status AS ENUM ('online', 'away', 'offline');
CREATE TYPE authentication_provider AS ENUM ('local', 'active_directory');
CREATE TYPE directory_tls_mode AS ENUM ('none', 'ldaps', 'starttls');
CREATE TYPE directory_sync_interval AS ENUM ('manual', 'hourly', 'daily', 'weekly');
CREATE TYPE directory_sync_status AS ENUM ('pending', 'running', 'success', 'partial', 'failed');
CREATE TYPE directory_chat_role AS ENUM ('system_admin', 'none');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(128) NOT NULL,
    password_hash VARCHAR(255),
    avatar_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    authentication_provider authentication_provider NOT NULL DEFAULT 'local',
    ad_guid VARCHAR(64),
    ad_sid VARCHAR(184),
    department VARCHAR(256),
    job_title VARCHAR(256),
    company VARCHAR(256),
    phone VARCHAR(64),
    manager VARCHAR(512),
    last_directory_sync TIMESTAMPTZ,
    directory_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    directory_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_users_ad_guid ON users (ad_guid) WHERE ad_guid IS NOT NULL;
CREATE UNIQUE INDEX idx_users_ad_sid ON users (ad_sid) WHERE ad_sid IS NOT NULL;
CREATE INDEX idx_users_authentication_provider ON users (authentication_provider);

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

CREATE TABLE polls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    anonymous BOOLEAN NOT NULL DEFAULT FALSE,
    allows_multiple BOOLEAN NOT NULL DEFAULT FALSE,
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT polls_question_not_empty CHECK (length(trim(question)) > 0)
);

CREATE TABLE poll_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT poll_options_text_not_empty CHECK (length(trim(text)) > 0)
);

CREATE INDEX idx_poll_options_poll
    ON poll_options (poll_id, position ASC);

CREATE TABLE poll_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (poll_id, user_id, option_id)
);

CREATE INDEX idx_poll_votes_poll
    ON poll_votes (poll_id);

CREATE INDEX idx_poll_votes_option
    ON poll_votes (option_id);

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

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    pending_assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    assignment_version INTEGER NOT NULL DEFAULT 0,
    assignment_offered_at TIMESTAMPTZ,
    assignment_responded_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tasks_title_not_empty CHECK (length(trim(title)) > 0),
    CONSTRAINT tasks_pending_differs_from_assigned CHECK (
        pending_assignee_id IS NULL
        OR assigned_to IS NULL
        OR pending_assignee_id <> assigned_to
    )
);

CREATE INDEX idx_tasks_created_by
    ON tasks (created_by, created_at DESC);

CREATE INDEX idx_tasks_assigned_to
    ON tasks (assigned_to, due_at ASC NULLS LAST)
    WHERE assigned_to IS NOT NULL;

CREATE INDEX idx_tasks_conversation
    ON tasks (conversation_id)
    WHERE conversation_id IS NOT NULL;

CREATE INDEX idx_tasks_open
    ON tasks (created_by, assigned_to)
    WHERE completed_at IS NULL;

CREATE INDEX idx_tasks_pending_assignee
    ON tasks (pending_assignee_id, assignment_offered_at DESC)
    WHERE pending_assignee_id IS NOT NULL AND completed_at IS NULL;

CREATE INDEX idx_tasks_pending_unread_assignee
    ON tasks (pending_assignee_id)
    WHERE pending_assignee_id IS NOT NULL
      AND completed_at IS NULL;

CREATE TABLE task_user_reads (
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, user_id)
);

CREATE INDEX idx_task_user_reads_user
    ON task_user_reads (user_id, last_read_at DESC);

CREATE TYPE note_member_role AS ENUM ('owner', 'contributor', 'reader');

CREATE TABLE notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    body TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notes_title_not_empty CHECK (length(trim(title)) > 0)
);

CREATE INDEX idx_notes_created_by
    ON notes (created_by, updated_at DESC);

CREATE TABLE note_members (
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role note_member_role NOT NULL,
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (note_id, user_id)
);

CREATE INDEX idx_note_members_user
    ON note_members (user_id, joined_at DESC);

CREATE TABLE note_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    edited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    changed_fields TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT note_revisions_version_positive CHECK (version > 0)
);

CREATE INDEX idx_note_revisions_note
    ON note_revisions (note_id, version DESC);

CREATE INDEX idx_note_revisions_editor
    ON note_revisions (edited_by, created_at DESC);

-- Ephemeral stories (24h) visible to the author's contacts.
CREATE TABLE stories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    caption TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT stories_caption_length CHECK (caption IS NULL OR length(caption) <= 500)
);

CREATE INDEX idx_stories_author_expires
    ON stories (author_id, expires_at DESC);

CREATE INDEX idx_stories_expires
    ON stories (expires_at);

CREATE INDEX idx_stories_attachment
    ON stories (attachment_id);

CREATE TABLE story_views (
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (story_id, viewer_id)
);

CREATE INDEX idx_story_views_viewer
    ON story_views (viewer_id, viewed_at DESC);

CREATE TABLE story_likes (
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (story_id, user_id)
);

CREATE INDEX idx_story_likes_user
    ON story_likes (user_id, liked_at DESC);

ALTER TABLE messages
    ADD COLUMN story_id UUID REFERENCES stories(id) ON DELETE SET NULL;

CREATE INDEX idx_messages_story_id
    ON messages (story_id)
    WHERE story_id IS NOT NULL;

CREATE TABLE directory_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_login_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    active_directory_login_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    default_provider authentication_provider NOT NULL DEFAULT 'local',
    allow_local_fallback BOOLEAN NOT NULL DEFAULT TRUE,
    auto_create_users BOOLEAN NOT NULL DEFAULT TRUE,
    auto_sync_profile BOOLEAN NOT NULL DEFAULT TRUE,
    auto_sync_department BOOLEAN NOT NULL DEFAULT TRUE,
    auto_sync_display_name BOOLEAN NOT NULL DEFAULT TRUE,
    auto_sync_email BOOLEAN NOT NULL DEFAULT TRUE,
    auto_sync_group_membership BOOLEAN NOT NULL DEFAULT TRUE,
    require_account_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    reject_locked_accounts BOOLEAN NOT NULL DEFAULT TRUE,
    reject_expired_passwords BOOLEAN NOT NULL DEFAULT TRUE,
    reject_expired_accounts BOOLEAN NOT NULL DEFAULT TRUE,
    require_approved_group BOOLEAN NOT NULL DEFAULT FALSE,
    ldap_host VARCHAR(255),
    ldap_port INTEGER NOT NULL DEFAULT 389,
    tls_mode directory_tls_mode NOT NULL DEFAULT 'none',
    validate_tls_certificate BOOLEAN NOT NULL DEFAULT TRUE,
    domain_name VARCHAR(255),
    base_dn VARCHAR(512),
    bind_dn VARCHAR(512),
    bind_password_encrypted TEXT,
    user_search_base VARCHAR(512),
    group_search_base VARCHAR(512),
    user_filter VARCHAR(512) NOT NULL DEFAULT '(&(objectCategory=person)(objectClass=user)(sAMAccountName={username}))',
    group_filter VARCHAR(512) NOT NULL DEFAULT '(objectClass=group)',
    connection_timeout_ms INTEGER NOT NULL DEFAULT 5000,
    read_timeout_ms INTEGER NOT NULL DEFAULT 10000,
    sync_interval directory_sync_interval NOT NULL DEFAULT 'manual',
    last_connection_test_at TIMESTAMPTZ,
    last_connection_test_ok BOOLEAN,
    last_connection_test_message TEXT,
    health_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO directory_configurations (id) VALUES (gen_random_uuid());

CREATE TABLE app_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voice_calls_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    video_calls_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_configurations (id) VALUES (gen_random_uuid());

CREATE TABLE directory_group_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_group_dn VARCHAR(1024) NOT NULL,
    ad_group_name VARCHAR(256) NOT NULL,
    chat_role directory_chat_role NOT NULL DEFAULT 'none',
    allow_login BOOLEAN NOT NULL DEFAULT TRUE,
    is_approved_security_group BOOLEAN NOT NULL DEFAULT FALSE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_directory_group_mappings_dn UNIQUE (ad_group_dn)
);

CREATE INDEX idx_directory_group_mappings_enabled
  ON directory_group_mappings (enabled);

CREATE TABLE directory_sync_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    triggered_by VARCHAR(32) NOT NULL DEFAULT 'manual',
    triggered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status directory_sync_status NOT NULL DEFAULT 'pending',
    users_examined INTEGER NOT NULL DEFAULT 0,
    users_updated INTEGER NOT NULL DEFAULT 0,
    users_created INTEGER NOT NULL DEFAULT 0,
    users_disabled INTEGER NOT NULL DEFAULT 0,
    groups_examined INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX idx_directory_sync_history_started
  ON directory_sync_history (started_at DESC);

CREATE TABLE authentication_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider authentication_provider NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    username VARCHAR(255),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    error_code VARCHAR(64),
    message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_authentication_audit_logs_created
  ON authentication_audit_logs (created_at DESC);
CREATE INDEX idx_authentication_audit_logs_provider
  ON authentication_audit_logs (provider);
CREATE INDEX idx_authentication_audit_logs_event
  ON authentication_audit_logs (event_type);
CREATE INDEX idx_authentication_audit_logs_success
  ON authentication_audit_logs (success);

CREATE INDEX idx_messages_story_id
    ON messages (story_id)
    WHERE story_id IS NOT NULL;

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
    ('027_message_thread_reads', '9a61e8893c2108fe7ce8f1c68eaaf64c5b0a8a97578c9065fd4100b25bb2ebba'),
    ('028_polls', 'd6f92cd7cfd8d6b3272865c1ceb8a1076180103e01d2323dbfbc1edf5287d544'),
    ('029_tasks', '3bd91f1bae7ec10b8985e4dfb887dbbf85294e8602ffc0e19a7a9568c87bc476'),
    ('030_task_assignment_acceptance', 'af9f274b3e46f0e19df6a78f688f34144a80c32fc069071a058a7335615d4cc5'),
    ('031_notes', '2e6a86c5b974a07cc0dae19cb51eac0c0a5891f971f1736289c4c6f13d340bf3'),
    ('032_stories', '6b4140450223ad67b5e50c5a0214eaed333a19fd09d910c8c98b6fb38c6f261c'),
    ('033_story_likes', '2175876714e4486f207281f3fa75f3e87f29c635a0e5a9e3de8f217960fb8bff'),
    ('034_directory_auth', '69f0dcec6c62e7c879c89ad7a2334f8b0cd2e3b1e11a1506d1067811b5e5d8f1'),
    ('035_app_configurations', '3784d5fa7f0ea664d57e8a821bfaa52c9ece9566c25e78e1382d0134aec0ddf6')
ON CONFLICT (version) DO NOTHING;

-- Grant app user access (required when schema is created by postgres superuser)
GRANT USAGE ON SCHEMA public TO chatapp;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO chatapp;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO chatapp;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO chatapp;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO chatapp;
