import { Conversation, DirectMessage, PublicUser } from '@igo/shared';
import type { Db } from './db.js';
import { USER_COLUMNS, UserRow, toPublicUser, userJson } from './users.js';

export const DM_MAX_LENGTH = 300;
/** Messages shown when a conversation is opened. */
export const DM_HISTORY = 100;
/** Messages older than this are removed. */
export const DM_KEEP_DAYS = 180;
export const MAX_CONVERSATIONS = 50;

interface DmRow {
  id: string;
  from_id: string;
  to_id: string;
  text: string;
  created_at: Date;
  read_at: Date | null;
}

const toDm = (r: DmRow): DirectMessage => ({
  id: String(r.id),
  fromId: String(r.from_id),
  toId: String(r.to_id),
  text: r.text,
  at: new Date(r.created_at).getTime(),
  readAt: r.read_at ? new Date(r.read_at).getTime() : null,
});

const isId = (id: string) => /^\d{1,18}$/.test(id);

/** Follows and messages between two people. */
export class Social {
  constructor(private db: Db) {}

  async following(userId: string): Promise<string[]> {
    const r = await this.db.query<{ followee_id: string }>('SELECT followee_id FROM follows WHERE follower_id = $1', [userId]);
    return r.rows.map((x) => String(x.followee_id));
  }

  async isFollowing(userId: string, otherId: string): Promise<boolean> {
    const r = await this.db.query('SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2', [userId, otherId]);
    return !!r.rowCount;
  }

  async counts(userId: string): Promise<{ following: number; followers: number }> {
    const r = await this.db.query<{ following: string; followers: string }>(
      `SELECT (SELECT count(*) FROM follows WHERE follower_id = $1) AS following,
              (SELECT count(*) FROM follows WHERE followee_id = $1) AS followers`,
      [userId],
    );
    return { following: Number(r.rows[0].following), followers: Number(r.rows[0].followers) };
  }

  /** Returns an error code, or null when done. */
  async setFollow(userId: string, otherId: string, follow: boolean): Promise<string | null> {
    if (!isId(otherId)) return 'no_such_user';
    if (otherId === userId) return 'invalid_target';
    if (!follow) {
      await this.db.query('DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', [userId, otherId]);
      return null;
    }
    const r = await this.db.query(
      `INSERT INTO follows (follower_id, followee_id) SELECT $1, id FROM users WHERE id = $2 ON CONFLICT DO NOTHING`,
      [userId, otherId],
    );
    if (!r.rowCount && !(await this.isFollowing(userId, otherId))) return 'no_such_user';
    return null;
  }

  /** The person a message may go to: a member who is not a computer player. */
  async recipient(userId: string, otherId: string): Promise<PublicUser | string> {
    if (!isId(otherId)) return 'no_such_user';
    if (otherId === userId) return 'invalid_target';
    const r = await this.db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [otherId]);
    const row = r.rows[0];
    if (!row) return 'no_such_user';
    if (row.bot) return 'invalid_target';
    return toPublicUser(row);
  }

  async send(fromId: string, toId: string, text: unknown): Promise<DirectMessage | null> {
    const t = String(text ?? '').trim().slice(0, DM_MAX_LENGTH);
    if (!t) return null;
    const r = await this.db.query<DmRow>(
      'INSERT INTO direct_messages (from_id, to_id, text) VALUES ($1, $2, $3) RETURNING *',
      [fromId, toId, t],
    );
    return toDm(r.rows[0]);
  }

  async history(userId: string, otherId: string, limit = DM_HISTORY): Promise<DirectMessage[]> {
    const r = await this.db.query<DmRow>(
      `SELECT * FROM direct_messages
       WHERE LEAST(from_id, to_id) = LEAST($1::bigint, $2::bigint) AND GREATEST(from_id, to_id) = GREATEST($1::bigint, $2::bigint)
       ORDER BY id DESC LIMIT $3`,
      [userId, otherId, limit],
    );
    return r.rows.reverse().map(toDm);
  }

  /** Marks the messages from the other person as read. */
  async markRead(userId: string, otherId: string): Promise<void> {
    await this.db.query('UPDATE direct_messages SET read_at = now() WHERE to_id = $1 AND from_id = $2 AND read_at IS NULL', [
      userId,
      otherId,
    ]);
  }

  /** The people I have messages with, latest first, with the last message and how many are unread. */
  async conversations(userId: string): Promise<Conversation[]> {
    const r = await this.db.query<DmRow & { u: UserRow; unread: string }>(
      `SELECT DISTINCT ON (other) m.*, ${userJson('u')} AS u,
              (SELECT count(*) FROM direct_messages x WHERE x.to_id = $1 AND x.from_id = u.id AND x.read_at IS NULL) AS unread
       FROM (SELECT d.*, CASE WHEN d.from_id = $1 THEN d.to_id ELSE d.from_id END AS other
             FROM direct_messages d WHERE d.from_id = $1 OR d.to_id = $1) m
       JOIN users u ON u.id = m.other
       ORDER BY other, m.id DESC`,
      [userId],
    );
    return r.rows
      .map((x) => ({ user: toPublicUser(x.u), last: toDm(x), unread: Number(x.unread) }))
      .sort((a, b) => Number(b.last.id) - Number(a.last.id))
      .slice(0, MAX_CONVERSATIONS);
  }

  async deleteOld(): Promise<number> {
    const r = await this.db.query('DELETE FROM direct_messages WHERE created_at < now() - make_interval(days => $1)', [DM_KEEP_DAYS]);
    return r.rowCount ?? 0;
  }
}
