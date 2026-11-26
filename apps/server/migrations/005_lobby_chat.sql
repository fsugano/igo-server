-- Messages in the lobby chat. Kept for a week; the lobby shows the latest ones.
CREATE TABLE lobby_messages (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lobby_messages_created ON lobby_messages (created_at);
