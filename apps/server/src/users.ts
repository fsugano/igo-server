import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PublicUser, Role, levelFor, rankLabel } from '@igo/shared';
import type { Db } from './db.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface UserRow {
  id: string;
  username: string;
  rating: number;
  games_played: number;
  plan: string;
  /** Engine id for computer players, null for people. */
  bot: string | null;
  role: Role;
  /** Consents to appearing by name in videos the operators publish. */
  allow_recording: boolean;
  display_name: string | null;
  display_name_changed_at: Date | null;
  declared_rank: string | null;
  avatar_id: string | null;
  games_completed: number;
}

/**
 * Columns read for a user. The password hash is left out: it is read only when checking a password (Users.credentials),
 * so it cannot slip into a reply by mistake.
 */
export const USER_COLUMNS =
  'id, username, rating, games_played, plan, bot, role, allow_recording, display_name, display_name_changed_at, declared_rank, avatar_id, games_completed';

/** A user's row as JSON for joins (e.g. `${userJson('b')} AS b`), without the password hash. */
export const userJson = (alias: string) =>
  `json_build_object(${USER_COLUMNS.split(', ')
    .map((c) => `'${c}', ${alias}.${c}`)
    .join(', ')})`;

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: String(u.id),
    username: u.username,
    rating: Math.round(u.rating),
    rank: rankLabel(u.rating),
    gamesPlayed: u.games_played,
    premium: u.plan === 'premium',
    bot: !!u.bot,
    displayName: u.display_name || u.username,
    avatarUrl: avatarUrl(u.avatar_id),
    level: levelFor(u.games_completed ?? 0),
  };
}

/** Where a picture is served. The id is random and new for each upload, so the files can be cached for good. */
export const avatarUrl = (id: string | null, size: 256 | 64 = 256) => (id ? `/avatars/${id}-${size}.webp` : null);

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const key = Buffer.from(keyB64, 'base64');
  const got = await scrypt(pw, Buffer.from(saltB64, 'base64'), key.length);
  return timingSafeEqual(key, got);
}

let dummy: Promise<string> | null = null;
/** A hash of a random password, compared against when a login names no existing user. */
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString('hex')));

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export class Users {
  constructor(private db: Db) {}

  async create(username: string, password: string, rating: number, declaredRank: string | null = null): Promise<UserRow | 'taken'> {
    const hash = await hashPassword(password);
    const r = await this.db.query<UserRow>(
      `INSERT INTO users (username, password_hash, rating, declared_rank) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING ${USER_COLUMNS}`,
      [username, hash, rating, declaredRank],
    );
    return r.rows[0] ?? 'taken';
  }

  /** Creates or updates the account a computer player plays under. Its password hash matches nothing. */
  async ensureBot(username: string, engineId: string, rating: number): Promise<UserRow> {
    const r = await this.db.query<UserRow>(
      `INSERT INTO users (username, password_hash, rating, bot) VALUES ($1, '!', $2, $3)
       ON CONFLICT (lower(username)) DO UPDATE SET bot = EXCLUDED.bot, rating = EXCLUDED.rating, password_hash = '!'
       RETURNING ${USER_COLUMNS}`,
      [username, rating, engineId],
    );
    return r.rows[0];
  }

  async byName(username: string): Promise<UserRow | null> {
    const r = await this.db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE lower(username) = lower($1)`, [username]);
    return r.rows[0] ?? null;
  }

  /** The user and their password hash, for checking a login. */
  async credentials(username: string): Promise<{ user: UserRow; passwordHash: string } | null> {
    const r = await this.db.query<UserRow & { password_hash: string }>(
      `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE lower(username) = lower($1)`,
      [username],
    );
    const row = r.rows[0];
    if (!row) return null;
    const { password_hash, ...user } = row;
    return { user, passwordHash: password_hash };
  }

  async byId(id: string): Promise<UserRow | null> {
    const r = await this.db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async createSession(userId: string, days: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
      [hashToken(token), userId, days],
    );
    return token;
  }

  async bySession(token: string | undefined): Promise<UserRow | null> {
    if (!token) return null;
    const r = await this.db.query<UserRow>(
      `SELECT ${USER_COLUMNS.split(', ').map((c) => `u.${c}`).join(', ')} FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)],
    );
    return r.rows[0] ?? null;
  }

  async setRole(username: string, role: Role): Promise<UserRow | null> {
    const r = await this.db.query<UserRow>(`UPDATE users SET role = $2 WHERE lower(username) = lower($1) AND bot IS NULL RETURNING ${USER_COLUMNS}`, [
      username,
      role,
    ]);
    return r.rows[0] ?? null;
  }

  async setAllowRecording(id: string, allow: boolean): Promise<void> {
    await this.db.query('UPDATE users SET allow_recording = $2 WHERE id = $1', [id, allow]);
  }

  /** Changes the nickname, at most once a day. Returns the row, or an error code. */
  async setDisplayName(id: string, name: string): Promise<UserRow | string> {
    const r = await this.db.query<UserRow>(
      `UPDATE users SET display_name = $2, display_name_changed_at = now()
       WHERE id = $1 AND (display_name_changed_at IS NULL OR display_name_changed_at < now() - interval '1 day')
       RETURNING ${USER_COLUMNS}`,
      [id, name],
    );
    return r.rows[0] ?? 'display_name_cooldown';
  }

  /**
   * Changes the declared rank. While the person has played fewer than `freeGames` rated games, the rating is set to
   * the rank's; after that only the label changes (so nobody can declare low and keep beating weaker players).
   */
  async setDeclaredRank(id: string, rank: string, rating: number, freeGames: number): Promise<UserRow | null> {
    const r = await this.db.query<UserRow>(
      `UPDATE users SET declared_rank = $2, rating = CASE WHEN games_played < $4 THEN $3 ELSE rating END
       WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, rank, rating, freeGames],
    );
    return r.rows[0] ?? null;
  }

  /** Sets the picture id (null removes it). Returns the previous id, for removing its files. */
  async setAvatar(id: string, avatarId: string | null): Promise<string | null> {
    const r = await this.db.query<{ old: string | null }>(
      `UPDATE users u SET avatar_id = $2 FROM (SELECT avatar_id AS old FROM users WHERE id = $1 FOR UPDATE) o
       WHERE u.id = $1 RETURNING o.old`,
      [id, avatarId],
    );
    return r.rows[0]?.old ?? null;
  }

  /** Removes expired sessions. Returns how many were removed. */
  async deleteExpiredSessions(): Promise<number> {
    const r = await this.db.query('DELETE FROM sessions WHERE expires_at <= now()');
    return r.rowCount ?? 0;
  }

  async deleteSession(token: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  }
}
