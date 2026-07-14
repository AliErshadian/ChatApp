-- Personal / shared tasks: create manually or from a chat message.

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    due_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tasks_title_not_empty CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_tasks_created_by
    ON tasks (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to
    ON tasks (assigned_to, due_at ASC NULLS LAST)
    WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_conversation
    ON tasks (conversation_id)
    WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_open
    ON tasks (created_by, assigned_to)
    WHERE completed_at IS NULL;
