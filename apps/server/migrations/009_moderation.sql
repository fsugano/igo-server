-- Leaving (the account is anonymised, its games stay) and suspension by the operators.
ALTER TABLE users
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN banned_at TIMESTAMPTZ;

-- One person blocking another: no challenges, messages or follows between them.
CREATE TABLE blocks (
  blocker_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked ON blocks (blocked_id);

-- Reports of people, pictures and messages. The reported text is copied, so it stays as evidence if deleted.
CREATE TABLE reports (
  id             BIGSERIAL PRIMARY KEY,
  reporter_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  target_type    TEXT NOT NULL CHECK (target_type IN ('user', 'avatar', 'lobbychat', 'dm')),
  target_id      TEXT NOT NULL,
  target_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reason         TEXT NOT NULL,
  detail         TEXT CHECK (detail IS NULL OR length(detail) <= 1000),
  snapshot       TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  action         TEXT,
  resolved_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reports_open ON reports (created_at) WHERE status = 'open';
