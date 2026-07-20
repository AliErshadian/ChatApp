-- Active Directory / multi-provider authentication support

-- Auth provider enum for local users
DO $$ BEGIN
  CREATE TYPE authentication_provider AS ENUM ('local', 'active_directory');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE directory_tls_mode AS ENUM ('none', 'ldaps', 'starttls');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE directory_sync_interval AS ENUM ('manual', 'hourly', 'daily', 'weekly');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE directory_sync_status AS ENUM ('pending', 'running', 'success', 'partial', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE directory_chat_role AS ENUM ('system_admin', 'none');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Allow AD-provisioned users without a local password
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS authentication_provider authentication_provider NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS ad_guid VARCHAR(64),
  ADD COLUMN IF NOT EXISTS ad_sid VARCHAR(184),
  ADD COLUMN IF NOT EXISTS department VARCHAR(256),
  ADD COLUMN IF NOT EXISTS job_title VARCHAR(256),
  ADD COLUMN IF NOT EXISTS company VARCHAR(256),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(64),
  ADD COLUMN IF NOT EXISTS manager VARCHAR(512),
  ADD COLUMN IF NOT EXISTS last_directory_sync TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS directory_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS directory_groups JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ad_guid
  ON users (ad_guid) WHERE ad_guid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ad_sid
  ON users (ad_sid) WHERE ad_sid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_authentication_provider
  ON users (authentication_provider);

-- Runtime authentication settings (hot-reloadable, no restart required)
CREATE TABLE IF NOT EXISTS directory_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Provider toggles
    local_login_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    active_directory_login_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    default_provider authentication_provider NOT NULL DEFAULT 'local',
    allow_local_fallback BOOLEAN NOT NULL DEFAULT TRUE,
    -- Provisioning / sync flags
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
    -- LDAP connection
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

-- Ensure a single configuration row exists
INSERT INTO directory_configurations (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM directory_configurations);

CREATE TABLE IF NOT EXISTS directory_group_mappings (
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

CREATE INDEX IF NOT EXISTS idx_directory_group_mappings_enabled
  ON directory_group_mappings (enabled);

CREATE TABLE IF NOT EXISTS directory_sync_history (
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

CREATE INDEX IF NOT EXISTS idx_directory_sync_history_started
  ON directory_sync_history (started_at DESC);

CREATE TABLE IF NOT EXISTS authentication_audit_logs (
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

CREATE INDEX IF NOT EXISTS idx_authentication_audit_logs_created
  ON authentication_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_authentication_audit_logs_provider
  ON authentication_audit_logs (provider);

CREATE INDEX IF NOT EXISTS idx_authentication_audit_logs_event
  ON authentication_audit_logs (event_type);

CREATE INDEX IF NOT EXISTS idx_authentication_audit_logs_success
  ON authentication_audit_logs (success);
