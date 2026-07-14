-- Per-user last-read cursor for Slack-style thread unread.

CREATE TABLE IF NOT EXISTS message_thread_reads (
    thread_root_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (thread_root_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_thread_reads_user
    ON message_thread_reads (user_id, last_read_at DESC);
