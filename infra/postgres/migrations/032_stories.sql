-- Ephemeral stories (24h) visible to the author's contacts.

CREATE TABLE IF NOT EXISTS stories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    caption TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT stories_caption_length CHECK (caption IS NULL OR length(caption) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_stories_author_expires
    ON stories (author_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_stories_expires
    ON stories (expires_at);

CREATE INDEX IF NOT EXISTS idx_stories_attachment
    ON stories (attachment_id);

CREATE TABLE IF NOT EXISTS story_views (
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (story_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_story_views_viewer
    ON story_views (viewer_id, viewed_at DESC);

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS story_id UUID REFERENCES stories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_story_id
    ON messages (story_id)
    WHERE story_id IS NOT NULL;
