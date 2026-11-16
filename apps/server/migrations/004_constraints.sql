-- Only the two states the server uses.
ALTER TABLE games ADD CONSTRAINT games_status_check CHECK (status IN ('active', 'finished'));
-- For removing expired sessions.
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);
