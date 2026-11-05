import type { AddressInfo } from 'node:net';
import type { ClientToServerEvents, GaugeState, SeekRequest, ServerToClientEvents } from '@igo/shared';
import { io as ioClient, Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Evaluator } from '../src/ai/gauge.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, migrate } from '../src/db.js';
import { Settings } from '../src/settings.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/igo_test';
const db = createDb(url);
let base = '';
let close: () => Promise<void>;
const sockets: Client[] = [];

/** Instant and predictable: black's chances grow by 1% per move played. */
const evaluator: Evaluator = {
  id: 'stub',
  async evaluate(game) {
    return 0.5 + game.moves.length / 100;
  },
};

beforeAll(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  const { app } = await buildApp({ ...loadConfig({}), databaseUrl: url }, db, { engines: [], evaluator });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  close = async () => {
    sockets.forEach((s) => s.close());
    await app.close();
    await db.end();
  };
});
afterAll(() => close());

async function register(username: string) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', rank: '5k' }),
  });
  expect(res.status).toBe(200);
  return { cookie: res.headers.get('set-cookie')!.split(';')[0], user: (await res.json()).user };
}

const api = (path: string, cookie?: string, init: { method?: string; body?: unknown } = {}) =>
  fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(cookie ? { cookie } : {}), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

async function connect(cookie?: string): Promise<Client> {
  const s: Client = ioClient(base, { extraHeaders: cookie ? { cookie } : {}, transports: ['websocket'] });
  sockets.push(s);
  await new Promise<void>((r) => s.on('connect', () => r()));
  return s;
}

const emit = <T = any>(s: Client, ev: string, ...args: unknown[]): Promise<T> =>
  new Promise((r) => (s.emit as any)(ev, ...args, r));

/** Records every gauge update a client gets, so none are missed between awaits. */
function gaugeLog(s: Client) {
  const seen: GaugeState[] = [];
  s.on('gauge:update', (g) => seen.push(g));
  return {
    seen,
    /** Resolves with the first update so far, or to come, that matches. */
    waitFor: (pred: (g: GaugeState) => boolean) =>
      new Promise<GaugeState>((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          const hit = seen.find(pred);
          if (hit) return resolve(hit);
          if (Date.now() - start > 5000) return reject(new Error('no matching gauge:update'));
          setTimeout(tick, 10);
        };
        tick();
      }),
  };
}

const lastMove = (g: GaugeState) => g.evals.at(-1)?.moveNumber ?? -1;

const seek: SeekRequest = {
  size: 9,
  komi: 6.5,
  handicap: 0,
  ruleset: 'japanese',
  clock: { type: 'byoyomi', mainTime: 600_000, periods: 3, periodTime: 30_000 },
  rated: false,
  color: 'black',
};

let admin: { cookie: string };
let black: { cookie: string; user: { id: string } };
let white: { cookie: string; user: { id: string } };

describe('operator settings', () => {
  it('only lets operators read and admins change them, within their rules', async () => {
    admin = await register('boss');
    expect((await api('/api/admin/settings')).status).toBe(401);
    expect((await api('/api/admin/settings', admin.cookie)).status).toBe(403);

    await db.query(`UPDATE users SET role = 'staff' WHERE username = 'boss'`);
    const read = await (await api('/api/admin/settings', admin.cookie)).json();
    expect(read.settings).toEqual({ liveDelayMoves: 3, recordingMethod: 'tab' });
    expect(read.recordingMethods.map((m: any) => [m.id, m.implemented])).toEqual([
      ['tab', true],
      ['canvas', false],
      ['webcodecs', false],
    ]);
    // Staff may look, not change.
    expect((await api('/api/admin/settings', admin.cookie, { method: 'PATCH', body: { liveDelayMoves: 2 } })).status).toBe(403);

    await db.query(`UPDATE users SET role = 'admin' WHERE username = 'boss'`);
    const me = await (await api('/api/me', admin.cookie)).json();
    expect(me.account).toEqual({ role: 'admin', allowRecording: false });
    for (const bad of [{ liveDelayMoves: 0 }, { liveDelayMoves: 11 }, { liveDelayMoves: 2.5 }, { recordingMethod: 'canvas' }, { other: 1 }]) {
      expect((await api('/api/admin/settings', admin.cookie, { method: 'PATCH', body: bad })).status).toBe(400);
    }
    const ok = await api('/api/admin/settings', admin.cookie, { method: 'PATCH', body: { liveDelayMoves: 2 } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).settings.liveDelayMoves).toBe(2);

    // Saved: a fresh store reads the same values back.
    expect(await new Settings(db).load()).toEqual({ liveDelayMoves: 2, recordingMethod: 'tab' });
  });
});

describe('evaluation gauge', () => {
  it('is refused to the players and reaches spectators the set number of moves late', async () => {
    black = await register('gaugeb');
    white = await register('gaugew');
    const sb = await connect(black.cookie);
    const sw = await connect(white.cookie);
    const viewer = await connect();
    const created = await emit(sb, 'seek:create', seek);
    const { gameId } = await emit(sw, 'seek:accept', created.seek.id);

    for (const s of [sb, sw]) expect((await emit(s, 'gauge:watch', gameId)).error).toBe('players_cannot_watch_gauge');
    // A second connection of the same player is refused too.
    expect((await emit(await connect(black.cookie), 'gauge:watch', gameId)).error).toBe('players_cannot_watch_gauge');
    const log = gaugeLog(viewer);
    const watched = await emit(viewer, 'gauge:watch', gameId);
    expect(watched.ok).toBe(true);
    expect(watched.gauge.delay).toBe(2);
    let playerGot = 0;
    for (const s of [sb, sw]) s.on('gauge:update', () => playerGot++);

    // Play 6 moves; the spectator may only see evaluations up to move 6 - 2 = 4.
    let n = 0;
    for (let y = 0; y < 3; y++) {
      expect((await emit(sb, 'game:move', gameId, y * 9 + 2, n++)).ok).toBe(true);
      expect((await emit(sw, 'game:move', gameId, y * 9 + 6, n++)).ok).toBe(true);
    }
    const seen = await log.waitFor((g) => lastMove(g) === 4);
    expect(seen.delay).toBe(2);
    expect(seen.evals.at(-1)!.winrateBlack).toBeCloseTo(0.54);
    // Never anything closer to the current position than the delay allows.
    expect(log.seen.every((g) => g.final || lastMove(g) <= 4)).toBe(true);

    // A new delay applies at once.
    expect((await api('/api/admin/settings', admin.cookie, { method: 'PATCH', body: { liveDelayMoves: 5 } })).status).toBe(200);
    expect(lastMove(await log.waitFor((g) => g.delay === 5))).toBeLessThanOrEqual(1);

    // When the game ends, everything is shown.
    expect((await emit(sb, 'game:resign', gameId)).ok).toBe(true);
    const f = await log.waitFor((g) => g.final);
    expect(f.delay).toBe(0);
    expect(lastMove(f)).toBe(6);
    expect(playerGot).toBe(0);
  });
});

describe('recording consent', () => {
  it('reports who agreed to be shown by name', async () => {
    expect((await api('/api/me/settings', black.cookie, { method: 'PATCH', body: { allowRecording: 'yes' } })).status).toBe(400);
    const r = await api('/api/me/settings', black.cookie, { method: 'PATCH', body: { allowRecording: true } });
    expect((await r.json()).account.allowRecording).toBe(true);

    const sb = await connect(black.cookie);
    const sw = await connect(white.cookie);
    const created = await emit(sb, 'seek:create', seek);
    const { gameId } = await emit(sw, 'seek:accept', created.seek.id);
    expect((await api(`/api/admin/broadcast/${gameId}`, black.cookie)).status).toBe(403);
    const info = await (await api(`/api/admin/broadcast/${gameId}`, admin.cookie)).json();
    expect(info).toEqual({ recordingMethod: 'tab', consent: { black: true, white: false } });
  });
});
