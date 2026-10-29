import { randomUUID } from 'node:crypto';
import { LobbyState, PublicUser, Seek, SeekRequest } from '@igo/shared';
import { z } from 'zod';

const MIN = 60_000;

const clockSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('byoyomi'),
      mainTime: z.number().int().min(0).max(180 * MIN),
      periods: z.number().int().min(0).max(10),
      periodTime: z.number().int().min(5_000).max(300_000),
    })
    .refine((c) => c.mainTime > 0 || c.periods > 0, 'no time'),
  z
    .object({
      type: z.literal('fischer'),
      mainTime: z.number().int().min(10_000).max(180 * MIN),
      increment: z.number().int().min(0).max(60_000),
      maxTime: z.number().int().max(360 * MIN),
    })
    .refine((c) => c.maxTime >= c.mainTime, 'maxTime < mainTime'),
]);

export const seekSchema = z.object({
  size: z.union([z.literal(9), z.literal(13), z.literal(19)]),
  komi: z.number().min(-50).max(50).refine((k) => Number.isInteger(k * 2), 'komi must be a multiple of 0.5'),
  handicap: z.number().int().min(0).max(9),
  ruleset: z.enum(['japanese', 'chinese']),
  clock: clockSchema,
  rated: z.boolean(),
  color: z.enum(['black', 'white', 'random']),
});

/** Conditions for a game against the computer: the seek conditions, with an engine id (or null for the requester) per colour. */
export const aiGameSchema = seekSchema.omit({ rated: true, color: true }).extend({
  black: z.string().max(64).nullable(),
  white: z.string().max(64).nullable(),
});

/** Handicap limits shared by seeks and computer games. */
export const validHandicap = (size: number, handicap: number) =>
  handicap !== 1 && (handicap <= 5 || size === 19);

const MAX_SEEKS_PER_USER = 3;

/** Open game requests and who is online. In memory: move to Redis when running several nodes. */
export class Lobby {
  readonly seeks = new Map<string, Seek>();
  private online = new Map<string, { user: PublicUser; sockets: number }>();

  connect(user: PublicUser) {
    const e = this.online.get(user.id);
    if (e) {
      e.sockets++;
      e.user = user;
    } else this.online.set(user.id, { user, sockets: 1 });
  }

  /** Returns true if this was the user's last connection. */
  disconnect(userId: string): boolean {
    const e = this.online.get(userId);
    if (!e) return false;
    if (--e.sockets > 0) return false;
    this.online.delete(userId);
    for (const [id, s] of this.seeks) if (s.creator.id === userId) this.seeks.delete(id);
    return true;
  }

  updateUser(user: PublicUser) {
    const e = this.online.get(user.id);
    if (e) e.user = user;
  }

  createSeek(creator: PublicUser, input: unknown): Seek | string {
    const parsed = seekSchema.safeParse(input);
    if (!parsed.success) return 'invalid_seek';
    const req: SeekRequest = parsed.data;
    if (!validHandicap(req.size, req.handicap)) return 'invalid_seek';
    const mine = [...this.seeks.values()].filter((s) => s.creator.id === creator.id);
    if (mine.length >= MAX_SEEKS_PER_USER) return 'too_many_seeks';
    const seek: Seek = { ...req, id: randomUUID(), creator, createdAt: Date.now() };
    this.seeks.set(seek.id, seek);
    return seek;
  }

  cancelSeek(userId: string, seekId: string): boolean {
    const s = this.seeks.get(seekId);
    if (!s || s.creator.id !== userId) return false;
    this.seeks.delete(seekId);
    return true;
  }

  /** Removes and returns the seek if it can be accepted by this user. */
  takeSeek(userId: string, seekId: string): Seek | string {
    const s = this.seeks.get(seekId);
    if (!s) return 'no_such_seek';
    if (s.creator.id === userId) return 'own_seek';
    this.seeks.delete(seekId);
    return s;
  }

  state(games: LobbyState['games']): LobbyState {
    return {
      seeks: [...this.seeks.values()].sort((a, b) => a.createdAt - b.createdAt),
      games,
      online: [...this.online.values()].map((e) => e.user).sort((a, b) => b.rating - a.rating),
    };
  }
}
