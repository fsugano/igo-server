import { REPORT_REASONS, Report, ReportReason, ReportTarget } from '@igo/shared';
import { z } from 'zod';
import type { Db } from './db.js';
import { UserRow, toPublicUser, userJson } from './users.js';

const isId = (id: string) => /^\d{1,18}$/.test(id);

export const reportSchema = z
  .object({
    targetType: z.enum(['user', 'avatar', 'lobbychat', 'dm']),
    targetId: z.string().regex(/^\d{1,18}$/),
    reason: z.enum(Object.keys(REPORT_REASONS) as [ReportReason, ...ReportReason[]]),
    detail: z.string().trim().max(1000).optional(),
  })
  .strict();

/** What an operator may do about a report. */
export const RESOLUTIONS = ['dismiss', 'warn', 'remove_avatar', 'delete_message', 'ban'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** Blocks between two people, and reports for the operators. */
export class Moderation {
  constructor(private db: Db) {}

  async blocked(userId: string): Promise<string[]> {
    const r = await this.db.query<{ blocked_id: string }>('SELECT blocked_id FROM blocks WHERE blocker_id = $1', [userId]);
    return r.rows.map((x) => String(x.blocked_id));
  }

  /** Whether either has blocked the other: then they cannot challenge, message or follow each other. */
  async blockedEither(a: string, b: string): Promise<boolean> {
    if (!isId(a) || !isId(b)) return false;
    const r = await this.db.query(
      'SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)',
      [a, b],
    );
    return !!r.rowCount;
  }

  /** Returns an error code, or null. Blocking also ends follows both ways. */
  async setBlock(userId: string, otherId: string, block: boolean): Promise<string | null> {
    if (!isId(otherId)) return 'no_such_user';
    if (otherId === userId) return 'invalid_target';
    if (!block) {
      await this.db.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [userId, otherId]);
      return null;
    }
    const r = await this.db.query(
      'INSERT INTO blocks (blocker_id, blocked_id) SELECT $1, id FROM users WHERE id = $2 AND bot IS NULL ON CONFLICT DO NOTHING',
      [userId, otherId],
    );
    if (!r.rowCount && !(await this.db.query('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [userId, otherId])).rowCount) {
      return 'no_such_user';
    }
    await this.db.query(
      'DELETE FROM follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)',
      [userId, otherId],
    );
    return null;
  }

  /** Records a report; the reported text is copied. Returns an error code, or null. */
  async report(reporterId: string, input: z.infer<typeof reportSchema>): Promise<string | null> {
    const { targetType: type, targetId: id } = input;
    let userId: string | null = null;
    let snapshot: string | null = null;
    if (type === 'user' || type === 'avatar') {
      const r = await this.db.query<{ id: string; display_name: string | null; username: string; avatar_id: string | null }>(
        'SELECT id, username, display_name, avatar_id FROM users WHERE id = $1 AND bot IS NULL AND deleted_at IS NULL',
        [id],
      );
      const u = r.rows[0];
      if (!u || (type === 'avatar' && !u.avatar_id)) return 'no_such_target';
      userId = String(u.id);
      snapshot = type === 'avatar' ? u.avatar_id : `${u.display_name ?? u.username} (@${u.username})`;
    } else if (type === 'lobbychat') {
      const r = await this.db.query<{ user_id: string; text: string }>('SELECT user_id, text FROM lobby_messages WHERE id = $1', [id]);
      if (!r.rows[0]) return 'no_such_target';
      userId = String(r.rows[0].user_id);
      snapshot = r.rows[0].text;
    } else {
      // Only a message the reporter received.
      const r = await this.db.query<{ from_id: string; text: string }>('SELECT from_id, text FROM direct_messages WHERE id = $1 AND to_id = $2', [
        id,
        reporterId,
      ]);
      if (!r.rows[0]) return 'no_such_target';
      userId = String(r.rows[0].from_id);
      snapshot = r.rows[0].text;
    }
    if (userId === reporterId) return 'invalid_target';
    await this.db.query(
      `INSERT INTO reports (reporter_id, target_type, target_id, target_user_id, reason, detail, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [reporterId, type, id, userId, input.reason, input.detail || null, snapshot],
    );
    return null;
  }

  async list(status: 'open' | 'closed'): Promise<Report[]> {
    const r = await this.db.query<{
      id: string;
      target_type: ReportTarget;
      target_id: string;
      reason: ReportReason;
      detail: string | null;
      snapshot: string | null;
      status: Report['status'];
      action: string | null;
      created_at: Date;
      t: UserRow | null;
      rep: UserRow | null;
    }>(
      `SELECT r.*, CASE WHEN t.id IS NULL THEN NULL ELSE ${userJson('t')} END AS t,
              CASE WHEN p.id IS NULL THEN NULL ELSE ${userJson('p')} END AS rep
       FROM reports r LEFT JOIN users t ON t.id = r.target_user_id LEFT JOIN users p ON p.id = r.reporter_id
       WHERE ${status === 'open' ? "r.status = 'open'" : "r.status <> 'open'"}
       ORDER BY r.id ${status === 'open' ? 'ASC' : 'DESC'} LIMIT 200`,
    );
    return r.rows.map((x) => ({
      id: String(x.id),
      targetType: x.target_type,
      targetId: x.target_id,
      targetUser: x.t ? toPublicUser(x.t) : null,
      reporter: x.rep ? toPublicUser(x.rep) : null,
      reason: x.reason,
      detail: x.detail,
      snapshot: x.snapshot,
      status: x.status,
      action: x.action,
      at: new Date(x.created_at).getTime(),
    }));
  }

  async get(id: string) {
    if (!isId(id)) return null;
    const r = await this.db.query<{ id: string; target_type: ReportTarget; target_id: string; target_user_id: string | null; status: string }>(
      'SELECT id, target_type, target_id, target_user_id, status FROM reports WHERE id = $1',
      [id],
    );
    return r.rows[0] ?? null;
  }

  /** Closes the report, and the other open ones about the same thing. */
  async close(id: string, by: string, action: Resolution) {
    await this.db.query(
      `UPDATE reports SET status = $3, action = $4, resolved_by = $2, resolved_at = now()
       WHERE status = 'open' AND (id = $1 OR (target_type, target_id) = (SELECT target_type, target_id FROM reports WHERE id = $1))`,
      [id, by, action === 'dismiss' ? 'dismissed' : 'resolved', action],
    );
  }

  /** Removes a reported message (lobby chat or one between two people). */
  async deleteMessage(type: ReportTarget, id: string) {
    if (type === 'lobbychat') await this.db.query('DELETE FROM lobby_messages WHERE id = $1', [id]);
    if (type === 'dm') await this.db.query('DELETE FROM direct_messages WHERE id = $1', [id]);
  }
}
