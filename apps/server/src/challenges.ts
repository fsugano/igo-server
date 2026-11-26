import { randomUUID } from 'node:crypto';
import { Challenge, ChallengeRequest, ChallengeUpdate, DECLINE_REASONS, PublicUser } from '@igo/shared';
import { seekSchema, validHandicap } from './lobby.js';

/** How long a challenge stays open. */
export const CHALLENGE_TTL_MS = 60_000;
/** After a decline, the same person may not challenge the same opponent again for this long. */
export const DECLINE_COOLDOWN_MS = 5 * 60_000;

export interface ChallengeEvents {
  received(c: Challenge): void;
  /** Sent to both people. */
  updated(c: Challenge, u: ChallengeUpdate): void;
}

/**
 * Games offered to one particular person. In memory (like the lobby): they last a minute at most.
 * Checks that need the rest of the server (online, in a game) are passed in by the caller.
 */
export class Challenges {
  private open = new Map<string, { c: Challenge; timer: ReturnType<typeof setTimeout> }>();
  private cooldown = new Map<string, number>();

  constructor(
    private events: ChallengeEvents,
    private now: () => number = Date.now,
  ) {}

  list(userId: string): Challenge[] {
    return [...this.open.values()].map((e) => e.c).filter((c) => c.from.id === userId || c.to.id === userId);
  }

  get(id: string): Challenge | undefined {
    return this.open.get(id)?.c;
  }

  /** Validates and opens a challenge. Returns an error code on failure. */
  create(from: PublicUser, to: PublicUser, input: unknown, counterOf?: string): Challenge | string {
    if (from.id === to.id) return 'own_challenge';
    if (to.bot) return 'invalid_target';
    const p = seekSchema.safeParse(input);
    if (!p.success || !validHandicap(p.data.size, p.data.handicap)) return 'invalid_seek';
    if (this.list(from.id).some((c) => c.from.id === from.id)) return 'challenge_pending';
    if (this.list(from.id).some((c) => c.from.id === to.id && c.to.id === from.id && !counterOf)) {
      return 'challenge_waiting_for_you';
    }
    const until = this.cooldown.get(`${from.id}>${to.id}`) ?? 0;
    if (until > this.now()) return 'challenge_cooldown';

    const request: ChallengeRequest = p.data;
    const c: Challenge = { id: randomUUID(), from, to, request, expiresAt: this.now() + CHALLENGE_TTL_MS, counterOf };
    const timer = setTimeout(() => this.close(c.id, { id: c.id, outcome: 'expired' }), CHALLENGE_TTL_MS);
    timer.unref?.();
    this.open.set(c.id, { c, timer });
    this.events.received(c);
    return c;
  }

  /** Removes an open challenge that the user may accept, so it cannot be accepted twice. */
  take(userId: string, id: string): Challenge | string {
    const e = this.open.get(id);
    if (!e) return 'no_such_challenge';
    if (e.c.to.id !== userId) return 'not_your_challenge';
    clearTimeout(e.timer);
    this.open.delete(id);
    return e.c;
  }

  /** Tells both sides how a challenge taken with take() ended (e.g. accepted, with the game). */
  finish(c: Challenge, u: ChallengeUpdate) {
    this.events.updated(c, u);
  }

  /** Puts back a challenge taken with take() when the game could not start. */
  restore(c: Challenge) {
    const left = c.expiresAt - this.now();
    if (left <= 0) return this.events.updated(c, { id: c.id, outcome: 'expired' });
    const timer = setTimeout(() => this.close(c.id, { id: c.id, outcome: 'expired' }), left);
    timer.unref?.();
    this.open.set(c.id, { c, timer });
  }

  decline(userId: string, id: string, reason?: string): true | string {
    const c = this.get(id);
    if (!c) return 'no_such_challenge';
    if (c.to.id !== userId) return 'not_your_challenge';
    const r = DECLINE_REASONS.find((x) => x === reason);
    this.cooldown.set(`${c.from.id}>${c.to.id}`, this.now() + DECLINE_COOLDOWN_MS);
    this.close(id, { id, outcome: 'declined', reason: r });
    return true;
  }

  /** Answers with different conditions: closes this one and opens one the other way. */
  counter(userId: string, id: string, input: unknown): Challenge | string {
    const c = this.get(id);
    if (!c) return 'no_such_challenge';
    if (c.to.id !== userId) return 'not_your_challenge';
    if (c.counterOf) return 'counter_once';
    // Close first: the challenger's pending challenge would otherwise block the reply.
    const e = this.open.get(id)!;
    clearTimeout(e.timer);
    this.open.delete(id);
    const reply = this.create(c.to, c.from, input, c.id);
    if (typeof reply === 'string') {
      this.open.set(id, e);
      e.timer = setTimeout(() => this.close(id, { id, outcome: 'expired' }), Math.max(0, c.expiresAt - this.now()));
      return reply;
    }
    this.events.updated(c, { id, outcome: 'countered', counter: reply });
    return reply;
  }

  cancel(userId: string, id: string): true | string {
    const c = this.get(id);
    if (!c) return 'no_such_challenge';
    if (c.from.id !== userId) return 'not_your_challenge';
    this.close(id, { id, outcome: 'cancelled' });
    return true;
  }

  /** Closes every challenge involving the user (they went offline or started a game). */
  dropUser(userId: string) {
    for (const c of this.list(userId)) this.close(c.id, { id: c.id, outcome: 'cancelled' });
  }

  stop() {
    for (const e of this.open.values()) clearTimeout(e.timer);
    this.open.clear();
  }

  private close(id: string, u: ChallengeUpdate) {
    const e = this.open.get(id);
    if (!e) return;
    clearTimeout(e.timer);
    this.open.delete(id);
    this.events.updated(e.c, u);
  }
}
