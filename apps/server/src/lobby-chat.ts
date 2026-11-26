import { LobbyChatMessage, PublicUser } from '@igo/shared';
import type { Db } from './db.js';
import { UserRow, toPublicUser, userJson } from './users.js';

/** Messages shown when someone opens the lobby. */
export const LOBBY_CHAT_HISTORY = 100;
/** Messages older than this are removed. */
export const LOBBY_CHAT_KEEP_DAYS = 7;
export const LOBBY_CHAT_MAX_LENGTH = 300;

/** The lobby's shared chat, kept in the database so it survives a restart. */
export class LobbyChat {
  constructor(private db: Db) {}

  async recent(limit = LOBBY_CHAT_HISTORY): Promise<LobbyChatMessage[]> {
    const r = await this.db.query<{ id: string; text: string; created_at: Date; u: UserRow }>(
      `SELECT m.id, m.text, m.created_at, ${userJson('u')} AS u FROM lobby_messages m JOIN users u ON u.id = m.user_id
       ORDER BY m.id DESC LIMIT $1`,
      [limit],
    );
    return r.rows.reverse().map((m) => ({ id: String(m.id), user: toPublicUser(m.u), text: m.text, at: new Date(m.created_at).getTime() }));
  }

  /** Stores a message. Returns null if there is nothing to say. */
  async post(user: PublicUser, text: unknown): Promise<LobbyChatMessage | null> {
    const t = String(text ?? '').trim().slice(0, LOBBY_CHAT_MAX_LENGTH);
    if (!t) return null;
    const r = await this.db.query<{ id: string; created_at: Date }>(
      'INSERT INTO lobby_messages (user_id, text) VALUES ($1, $2) RETURNING id, created_at',
      [user.id, t],
    );
    return { id: String(r.rows[0].id), user, text: t, at: new Date(r.rows[0].created_at).getTime() };
  }

  /** Removes old messages. Returns how many were removed. */
  async deleteOld(): Promise<number> {
    const r = await this.db.query(`DELETE FROM lobby_messages WHERE created_at < now() - make_interval(days => $1)`, [LOBBY_CHAT_KEEP_DAYS]);
    return r.rowCount ?? 0;
  }
}
