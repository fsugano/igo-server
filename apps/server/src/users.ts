import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PublicUser, rankLabel } from '@igo/shared';
import type { Db } from './db.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  rating: number;
  games_played: number;
  plan: string;
  /** Engine id for computer players, null for people. */
  bot: string | null;
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: String(u.id),
    username: u.username,
    rating: Math.round(u.rating),
    rank: rankLabel(u.rating),
    gamesPlayed: u.games_played,
    premium: u.plan === 'premium',
    bot: !!u.bot,
  };
}

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

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export class Users {
  constructor(private db: Db) {}

  async create(username: string, password: string, rating: number): Promise<UserRow | 'taken'> {
    const hash = await hashPassword(password);
    const r = await this.db.query<UserRow>(
      `INSERT INTO users (username, password_hash, rating) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING *`,
      [username, hash, rating],
    );
    return r.rows[0] ?? 'taken';
  }

  /** Creates or updates the account a computer player plays under. Its password hash matches nothing. */
  async ensureBot(username: string, engineId: string, rating: number): Promise<UserRow> {
    const r = await this.db.query<UserRow>(
      `INSERT INTO users (username, password_hash, rating, bot) VALUES ($1, '!', $2, $3)
       ON CONFLICT (lower(username)) DO UPDATE SET bot = EXCLUDED.bot, rating = EXCLUDED.rating, password_hash = '!'
       RETURNING *`,
      [username, rating, engineId],
    );
    return r.rows[0];
  }

  async byName(username: string): Promise<UserRow | null> {
    const r = await this.db.query<UserRow>('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
    return r.rows[0] ?? null;
  }

  async byId(id: string): Promise<UserRow | null> {
    const r = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
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
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)],
    );
    return r.rows[0] ?? null;
  }

  async deleteSession(token: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  }
}
