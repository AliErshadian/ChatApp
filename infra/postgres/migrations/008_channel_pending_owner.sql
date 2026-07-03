ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS pending_owner_id UUID REFERENCES users(id);
