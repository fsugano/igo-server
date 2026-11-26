-- Nickname, declared rank, picture and the count behind the user level.
ALTER TABLE users
  ADD COLUMN display_name TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 20),
  ADD COLUMN display_name_changed_at TIMESTAMPTZ,
  ADD COLUMN declared_rank TEXT,
  ADD COLUMN avatar_id TEXT,
  ADD COLUMN games_completed INTEGER NOT NULL DEFAULT 0;

-- Games played to the end so far (at least 4 moves). The daily limits apply from now on only.
UPDATE users u SET games_completed = c.n
FROM (
  SELECT p.id, count(*) AS n
  FROM games g
  JOIN users b ON b.id = g.black_id
  JOIN users w ON w.id = g.white_id
  CROSS JOIN LATERAL (VALUES (g.black_id), (g.white_id)) AS p(id)
  WHERE g.status = 'finished' AND jsonb_array_length(g.moves) >= 4 AND NOT (b.bot IS NOT NULL AND w.bot IS NOT NULL)
  GROUP BY p.id
) c
WHERE u.id = c.id AND u.bot IS NULL;
