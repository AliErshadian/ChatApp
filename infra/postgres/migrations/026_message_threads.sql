-- Slack-style threads: replies hang off a root message and stay out of the main feed.

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS thread_root_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS reply_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS latest_reply_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_messages_thread_root
    ON messages (thread_root_id, sequence ASC)
    WHERE thread_root_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_main
    ON messages (conversation_id, sequence DESC)
    WHERE thread_root_id IS NULL;
