CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rating        DOUBLE PRECISION NOT NULL,
  games_played  INTEGER NOT NULL DEFAULT 0,
  plan          TEXT NOT NULL DEFAULT 'free',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE games (
  id              BIGSERIAL PRIMARY KEY,
  black_id        BIGINT NOT NULL REFERENCES users(id),
  white_id        BIGINT NOT NULL REFERENCES users(id),
  settings        JSONB NOT NULL,
  clock_settings  JSONB NOT NULL,
  rated           BOOLEAN NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  moves           JSONB NOT NULL DEFAULT '[]',
  clocks          JSONB NOT NULL,
  black_rating    DOUBLE PRECISION NOT NULL,
  white_rating    DOUBLE PRECISION NOT NULL,
  result          TEXT,
  rating_change   JSONB,
  sgf             TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ
);
CREATE INDEX games_black ON games (black_id, started_at DESC);
CREATE INDEX games_white ON games (white_id, started_at DESC);
CREATE INDEX games_active ON games (status) WHERE status = 'active';
