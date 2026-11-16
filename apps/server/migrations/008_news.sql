-- Announcements written by the operators.
CREATE TABLE news (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  body        TEXT NOT NULL CHECK (length(body) <= 20000),
  category    TEXT NOT NULL CHECK (category IN ('info', 'maintenance', 'update', 'event')),
  important   BOOLEAN NOT NULL DEFAULT false,
  pinned      BOOLEAN NOT NULL DEFAULT false,
  -- null while a draft; shown from this time.
  publish_at  TIMESTAMPTZ,
  expire_at   TIMESTAMPTZ,
  lang        TEXT NOT NULL DEFAULT 'ja',
  author_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX news_publish ON news (publish_at DESC, id DESC) WHERE publish_at IS NOT NULL;

-- When the user last opened the news list: newer published items are unread.
ALTER TABLE users ADD COLUMN news_read_at TIMESTAMPTZ;

-- What operators did, who and when.
CREATE TABLE admin_audit (
  id       BIGSERIAL PRIMARY KEY,
  user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action   TEXT NOT NULL,
  target   TEXT,
  detail   JSONB,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_at ON admin_audit (at DESC);
