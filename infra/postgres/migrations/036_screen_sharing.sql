-- Screen sharing: sessions, participants, audit, group settings, moderator role, app config

-- Moderator role for group screen-share start permission
DO $$ BEGIN
  ALTER TYPE member_role ADD VALUE IF NOT EXISTS 'moderator';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping member_role ADD VALUE moderator (not type owner). Grant ownership or add manually.';
  WHEN OTHERS THEN
    IF SQLERRM LIKE '%already exists%' OR SQLSTATE = '42710' THEN
      NULL;
    ELSE
      RAISE;
    END IF;
END $$;

-- App-wide screen sharing feature flags / limits
ALTER TABLE app_configurations
  ADD COLUMN IF NOT EXISTS screen_sharing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS screen_sharing_direct_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS screen_sharing_groups_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS screen_max_resolution VARCHAR(16) NOT NULL DEFAULT '1080p',
  ADD COLUMN IF NOT EXISTS screen_max_fps INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS screen_max_concurrent_sessions INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS screen_bandwidth_limit_kbps INTEGER;

-- Per-conversation (group) screen sharing settings
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS screen_sharing_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS screen_allow_multiple_presenters BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS screen_max_concurrent_shares INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS screen_max_participants INTEGER NOT NULL DEFAULT 8;

DO $$ BEGIN
  CREATE TYPE screen_share_session_status AS ENUM ('active', 'ended');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE screen_share_source AS ENUM ('screen', 'window', 'monitor', 'application');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE screen_share_participant_role AS ENUM ('presenter', 'viewer');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS screen_share_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    conversation_type conversation_type NOT NULL,
    host_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status screen_share_session_status NOT NULL DEFAULT 'active',
    screen_source screen_share_source,
    quality_hint VARCHAR(32),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_screen_share_sessions_conversation
  ON screen_share_sessions (conversation_id, status);

CREATE INDEX IF NOT EXISTS idx_screen_share_sessions_host
  ON screen_share_sessions (host_user_id, status);

CREATE TABLE IF NOT EXISTS screen_share_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES screen_share_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role screen_share_participant_role NOT NULL DEFAULT 'viewer',
    connection_state VARCHAR(32) NOT NULL DEFAULT 'joining',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    CONSTRAINT uq_screen_share_participants_session_user UNIQUE (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_screen_share_participants_session
  ON screen_share_participants (session_id);

CREATE TABLE IF NOT EXISTS screen_share_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES screen_share_sessions(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(64) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_screen_share_audit_created
  ON screen_share_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_screen_share_audit_session
  ON screen_share_audit_logs (session_id);
