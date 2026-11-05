-- Operators: admin may change settings, staff may use the recording mode.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'staff', 'admin'));
-- Consent to appear by name in videos the operators publish. Off until the user turns it on.
ALTER TABLE users ADD COLUMN allow_recording BOOLEAN NOT NULL DEFAULT false;

-- Settings changed from the admin screen, one row per key.
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
