-- Personal and shared notes with member roles and revision history.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'note_member_role') THEN
    CREATE TYPE note_member_role AS ENUM ('owner', 'contributor', 'reader');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    body TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notes_title_not_empty CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_notes_created_by
    ON notes (created_by, updated_at DESC);

CREATE TABLE IF NOT EXISTS note_members (
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role note_member_role NOT NULL,
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (note_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_note_members_user
    ON note_members (user_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS note_revisions (
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

CREATE INDEX IF NOT EXISTS idx_note_revisions_note
    ON note_revisions (note_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_note_revisions_editor
    ON note_revisions (edited_by, created_at DESC);
