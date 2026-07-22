-- Allow admins to disable local self-registration independently of local login
ALTER TABLE directory_configurations
  ADD COLUMN IF NOT EXISTS local_registration_enabled BOOLEAN NOT NULL DEFAULT TRUE;
