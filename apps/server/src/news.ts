import { NewsCategory, NewsItem } from '@igo/shared';
import { z } from 'zod';
import type { Db } from './db.js';

export const NEWS_PAGE = 20;

const time = z.number().int().min(0).max(8_640_000_000_000).nullable();
export const newsSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    body: z.string().max(20_000),
    category: z.enum(['info', 'maintenance', 'update', 'event']),
    important: z.boolean(),
    pinned: z.boolean(),
    publishAt: time,
    expireAt: time,
  })
  .strict()
  .refine((n) => n.publishAt === null || n.expireAt === null || n.expireAt > n.publishAt, 'expireAt before publishAt');
export type NewsInput = z.infer<typeof newsSchema>;

interface Row {
  id: string;
  title: string;
  body: string;
  category: NewsCategory;
  important: boolean;
  pinned: boolean;
  publish_at: Date | null;
  expire_at: Date | null;
}

const ms = (d: Date | null) => (d ? new Date(d).getTime() : null);
const toItem = (r: Row): NewsItem => ({
  id: String(r.id),
  title: r.title,
  body: r.body,
  category: r.category,
  important: r.important,
  pinned: r.pinned,
  publishAt: ms(r.publish_at),
  expireAt: ms(r.expire_at),
});
const toDate = (t: number | null) => (t === null ? null : new Date(t));
const isId = (id: string) => /^\d{1,18}$/.test(id);

/** Shown to everyone now: published, and not yet taken down. */
const VISIBLE = 'n.publish_at IS NOT NULL AND n.publish_at <= now() AND (n.expire_at IS NULL OR n.expire_at > now())';

export class News {
  constructor(private db: Db) {}

  /** Visible items, newest first, 20 at a time. Pinned ones come first on the first page. */
  async list(category: string | undefined, before: string | undefined): Promise<{ items: NewsItem[]; more: boolean }> {
    const params: unknown[] = [];
    const where = [VISIBLE];
    if (category) {
      params.push(category);
      where.push(`n.category = $${params.length}`);
    }
    if (before && isId(before)) {
      // Pages after the first are plain date order (the pinned ones were shown already).
      params.push(before);
      where.push(`(n.publish_at, n.id) < (SELECT publish_at, id FROM news WHERE id = $${params.length})`);
      where.push('NOT n.pinned');
    }
    params.push(NEWS_PAGE + 1);
    const order = before ? 'n.publish_at DESC, n.id DESC' : 'n.pinned DESC, n.publish_at DESC, n.id DESC';
    const r = await this.db.query<Row>(
      `SELECT n.* FROM news n WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $${params.length}`,
      params,
    );
    return { items: r.rows.slice(0, NEWS_PAGE).map(toItem), more: r.rows.length > NEWS_PAGE };
  }

  async get(id: string, includeHidden = false): Promise<NewsItem | null> {
    if (!isId(id)) return null;
    const r = await this.db.query<Row>(`SELECT n.* FROM news n WHERE n.id = $1 ${includeHidden ? '' : `AND ${VISIBLE}`}`, [id]);
    return r.rows[0] ? toItem(r.rows[0]) : null;
  }

  /** Visible important items, for the banner. */
  async important(): Promise<NewsItem[]> {
    const r = await this.db.query<Row>(`SELECT n.* FROM news n WHERE n.important AND ${VISIBLE} ORDER BY n.publish_at DESC LIMIT 5`);
    return r.rows.map(toItem);
  }

  async unreadCount(userId: string): Promise<number> {
    const r = await this.db.query<{ c: string }>(
      `SELECT count(*) AS c FROM news n JOIN users u ON u.id = $1
       WHERE ${VISIBLE} AND (u.news_read_at IS NULL OR n.publish_at > u.news_read_at)`,
      [userId],
    );
    return Number(r.rows[0].c);
  }

  async markRead(userId: string) {
    await this.db.query('UPDATE users SET news_read_at = now() WHERE id = $1', [userId]);
  }

  /** Everything, drafts included, for the operators. */
  async all(): Promise<NewsItem[]> {
    const r = await this.db.query<Row>('SELECT * FROM news ORDER BY COALESCE(publish_at, created_at) DESC, id DESC LIMIT 200');
    return r.rows.map(toItem);
  }

  async create(n: NewsInput, authorId: string): Promise<NewsItem> {
    const r = await this.db.query<Row>(
      `INSERT INTO news (title, body, category, important, pinned, publish_at, expire_at, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [n.title, n.body, n.category, n.important, n.pinned, toDate(n.publishAt), toDate(n.expireAt), authorId],
    );
    return toItem(r.rows[0]);
  }

  async update(id: string, n: NewsInput): Promise<NewsItem | null> {
    if (!isId(id)) return null;
    const r = await this.db.query<Row>(
      `UPDATE news SET title = $2, body = $3, category = $4, important = $5, pinned = $6, publish_at = $7, expire_at = $8,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, n.title, n.body, n.category, n.important, n.pinned, toDate(n.publishAt), toDate(n.expireAt)],
    );
    return r.rows[0] ? toItem(r.rows[0]) : null;
  }

  async remove(id: string): Promise<boolean> {
    if (!isId(id)) return false;
    return !!(await this.db.query('DELETE FROM news WHERE id = $1', [id])).rowCount;
  }

  /** Items that became visible in (since, now], for telling the people online. */
  async publishedBetween(since: Date): Promise<NewsItem[]> {
    const r = await this.db.query<Row>(`SELECT n.* FROM news n WHERE ${VISIBLE} AND n.publish_at > $1 ORDER BY n.publish_at`, [since]);
    return r.rows.map(toItem);
  }

  async audit(userId: string, action: string, target: string | null, detail?: unknown) {
    await this.db.query('INSERT INTO admin_audit (user_id, action, target, detail) VALUES ($1, $2, $3, $4)', [
      userId,
      action,
      target,
      detail === undefined ? null : JSON.stringify(detail),
    ]);
  }
}
