-- Task assignment requires recipient acceptance before becoming the accepted assignee.
-- pending_assignee_id holds the offer; assigned_to is only set after accept (or self-assign).

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS pending_assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignment_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assignment_offered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assignment_responded_at TIMESTAMPTZ;

-- Existing assigned rows are treated as already accepted.
UPDATE tasks
SET
  assignment_version = 1,
  assignment_responded_at = COALESCE(updated_at, created_at)
WHERE assigned_to IS NOT NULL
  AND assignment_version = 0
  AND assignment_responded_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_pending_differs_from_assigned'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_pending_differs_from_assigned CHECK (
        pending_assignee_id IS NULL
        OR assigned_to IS NULL
        OR pending_assignee_id <> assigned_to
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_pending_assignee
  ON tasks (pending_assignee_id, assignment_offered_at DESC)
  WHERE pending_assignee_id IS NOT NULL AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_pending_unread_assignee
  ON tasks (pending_assignee_id)
  WHERE pending_assignee_id IS NOT NULL
    AND completed_at IS NULL;

CREATE TABLE IF NOT EXISTS task_user_reads (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_user_reads_user
  ON task_user_reads (user_id, last_read_at DESC);
