import type { PublicUser, SeekRequest } from '@igo/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHALLENGE_TTL_MS, Challenges } from '../src/challenges.js';

const user = (id: string, bot = false): PublicUser => ({ id, username: `u${id}`, rating: 1500, rank: '1級', gamesPlayed: 0, premium: false, bot, displayName: `u${id}`, avatarUrl: null, level: 1 });
const req: SeekRequest = {
  size: 19,
  komi: 6.5,
  handicap: 0,
  ruleset: 'japanese',
  clock: { type: 'byoyomi', mainTime: 600_000, periods: 3, periodTime: 30_000 },
  rated: true,
  color: 'random',
};

function setup() {
  const events: string[] = [];
  const ch = new Challenges({
    received: (c) => events.push(`received ${c.from.id}>${c.to.id}`),
    updated: (_c, u) => events.push(`${u.outcome}`),
  });
  return { ch, events };
}

afterEach(() => vi.useRealTimers());

describe('challenges', () => {
  it('refuses bad targets and conditions', () => {
    const { ch } = setup();
    expect(ch.create(user('1'), user('1'), req)).toBe('own_challenge');
    expect(ch.create(user('1'), user('2', true), req)).toBe('invalid_target');
    expect(ch.create(user('1'), user('2'), { ...req, handicap: 1 })).toBe('invalid_seek');
    expect(ch.create(user('1'), user('2'), { ...req, size: 7 })).toBe('invalid_seek');
  });

  it('lapses after a minute', () => {
    vi.useFakeTimers();
    const { ch, events } = setup();
    const c = ch.create(user('1'), user('2'), req);
    expect(typeof c).toBe('object');
    vi.advanceTimersByTime(CHALLENGE_TTL_MS + 1);
    expect(events).toEqual(['received 1>2', 'expired']);
    expect(ch.list('1')).toEqual([]);
  });

  it('cannot be accepted twice, and is put back when the game cannot start', () => {
    const { ch } = setup();
    const c = ch.create(user('1'), user('2'), req);
    if (typeof c === 'string') throw new Error(c);
    expect(ch.take('1', c.id)).toBe('not_your_challenge');
    expect(typeof ch.take('2', c.id)).toBe('object');
    expect(ch.take('2', c.id)).toBe('no_such_challenge');
    ch.restore(c);
    expect(ch.get(c.id)).toBeTruthy();
  });

  it('waits for an answer to a challenge already received from the same person', () => {
    const { ch } = setup();
    ch.create(user('1'), user('2'), req);
    expect(ch.create(user('2'), user('1'), req)).toBe('challenge_waiting_for_you');
  });

  it('keeps the original when a counter-offer is invalid, and drops everything for a user who leaves', () => {
    const { ch, events } = setup();
    const c = ch.create(user('1'), user('2'), req);
    if (typeof c === 'string') throw new Error(c);
    expect(ch.counter('2', c.id, { ...req, size: 5 })).toBe('invalid_seek');
    expect(ch.get(c.id)).toBeTruthy();
    ch.create(user('3'), user('2'), req);
    ch.dropUser('2');
    expect(ch.list('2')).toEqual([]);
    expect(events.filter((e) => e === 'cancelled')).toHaveLength(2);
    ch.stop();
  });
});
