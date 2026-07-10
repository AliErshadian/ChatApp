ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Promote your first admin (replace email):
-- UPDATE users SET is_admin = TRUE WHERE email = 'admin@company.com';
