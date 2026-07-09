ALTER TABLE conversation_members
    ADD COLUMN pinned_at TIMESTAMPTZ;

CREATE INDEX idx_conversation_members_pinned
    ON conversation_members (user_id, pinned_at DESC NULLS LAST)
    WHERE pinned_at IS NOT NULL;
