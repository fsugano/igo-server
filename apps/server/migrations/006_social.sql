-- One-way follows: no permission needed from the person followed.
CREATE TABLE follows (
  follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee ON follows (followee_id);

-- Messages between two people. Kept for 180 days.
CREATE TABLE direct_messages (
  id         BIGSERIAL PRIMARY KEY,
  from_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ,
  CHECK (from_id <> to_id)
);
CREATE INDEX direct_messages_pair ON direct_messages (LEAST(from_id, to_id), GREATEST(from_id, to_id), id);
CREATE INDEX direct_messages_unread ON direct_messages (to_id) WHERE read_at IS NULL;
CREATE INDEX direct_messages_created ON direct_messages (created_at);
