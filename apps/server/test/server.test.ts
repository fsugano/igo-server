import type { AddressInfo } from 'node:net';
import { Game, PASS, Stone } from '@igo/shared';
import type { AiGameRequest, ClientToServerEvents, GameView, ServerToClientEvents, SeekRequest } from '@igo/shared';
import { io as ioClient, Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILTIN_LEVELS, BuiltinEngine } from '../src/ai/builtin.js';
import type { Engine, EngineMove } from '../src/ai/index.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, migrate } from '../src/db.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/igo_test';
const db = createDb(url);
let base = '';
let close: () => Promise<void>;
const sockets: Client[] = [];

/** Predictable computer player: plays the first legal point from the top-left, passes after a pass. */
const stub: Engine = {
  id: 'stub',
  username: 'AI-Stub',
  label: 'Stub',
  rank: '30k',
  async genMove(game: Game, color: Stone): Promise<EngineMove> {
    if (game.moves.at(-1)?.p === PASS) return { type: 'pass' };
    for (let p = 0; p < game.board.cells.length; p++) {
      if (typeof game.board.play(p, color, game.koPoint) !== 'string') return { type: 'play', p };
    }
    return { type: 'pass' };
  },
  async deadStones() {
    return [];
  },
};

beforeAll(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  const engines = [new BuiltinEngine(BUILTIN_LEVELS[0], 1), stub];
  const { app } = await buildApp({ ...loadConfig({}), databaseUrl: url }, db, { engines, moveDelayMs: 0, aiVsAiDelayMs: 0 });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  close = async () => {
    sockets.forEach((s) => s.close());
    await app.close();
    await db.end();
  };
});
afterAll(() => close());

async function register(username: string, rank = '5k') {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', rank }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  const body = await res.json();
  return { cookie, user: body.user };
}

async function connect(cookie?: string): Promise<Client> {
  const s: Client = ioClient(base, { extraHeaders: cookie ? { cookie } : {}, transports: ['websocket'] });
  sockets.push(s);
  await new Promise<void>((r) => s.on('connect', () => r()));
  return s;
}

const emit = <T = any>(s: Client, ev: string, ...args: unknown[]): Promise<T> =>
  new Promise((r) => (s.emit as any)(ev, ...args, r));

const nextUpdate = (s: Client, pred: (g: GameView) => boolean = () => true) =>
  new Promise<GameView>((r) => {
    const h = (g: GameView) => {
      if (pred(g)) {
        s.off('game:update', h);
        r(g);
      }
    };
    s.on('game:update', h);
  });

const seek: SeekRequest = {
  size: 9,
  komi: 6.5,
  handicap: 0,
  ruleset: 'japanese',
  clock: { type: 'byoyomi', mainTime: 600_000, periods: 3, periodTime: 30_000 },
  rated: true,
  color: 'black',
};

describe('auth', () => {
  it('registers, rejects duplicates, logs in and reports me', async () => {
    const { cookie, user } = await register('alice', '3d');
    expect(user.rank).toBe('3段');
    const dup = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ALICE', password: 'password123', rank: '1k' }),
    });
    expect(dup.status).toBe(409);
    const spaced = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Matcha Dainagon', password: 'password123', rank: '6d' }),
    });
    expect(spaced.status).toBe(400);
    expect((await spaced.json()).error).toBe('invalid_username');
    const bad = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'wrong-password' }),
    });
    expect(bad.status).toBe(401);
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
    expect(me.user.username).toBe('alice');
  });
});

describe('play', () => {
  it('plays a full rated game to an agreed score', async () => {
    const b = await register('black1');
    const w = await register('white1');
    const sb = await connect(b.cookie);
    const sw = await connect(w.cookie);
    const spectator = await connect();

    const lobbyRes = await emit(sw, 'lobby:join');
    expect(lobbyRes.ok).toBe(true);
    const created = await emit(sb, 'seek:create', seek);
    expect(created.ok).toBe(true);
    expect((await emit(sb, 'seek:accept', created.seek.id)).error).toBe('own_seek');

    const started = new Promise<string>((r) => sb.once('game:start', r));
    const accepted = await emit(sw, 'seek:accept', created.seek.id);
    expect(accepted.ok).toBe(true);
    const gameId = accepted.gameId;
    expect(await started).toBe(gameId);

    for (const s of [sb, sw, spectator]) expect((await emit(s, 'game:join', gameId)).ok).toBe(true);
    expect((await emit(spectator, 'game:move', gameId, 0, 0)).error).toBe('login_required');
    expect((await emit(sw, 'game:move', gameId, 0, 0)).error).toBe('not_your_turn');

    // Black takes the left columns, white the right; play 10 moves.
    let n = 0;
    for (let y = 0; y < 5; y++) {
      expect((await emit(sb, 'game:move', gameId, y * 9 + 2, n++)).ok).toBe(true);
      expect((await emit(sw, 'game:move', gameId, y * 9 + 6, n++)).ok).toBe(true);
    }
    expect((await emit(sb, 'game:move', gameId, 2, 3)).error).toBe('stale_move');
    const scoring = nextUpdate(spectator, (g) => g.state.phase === 'scoring');
    expect((await emit(sb, 'game:pass', gameId, n++)).ok).toBe(true);
    expect((await emit(sw, 'game:pass', gameId, n++)).ok).toBe(true);
    const sv = await scoring;
    expect(sv.turnStartedAt).toBeNull();

    const done = nextUpdate(spectator, (g) => g.state.phase === 'finished');
    expect((await emit(sb, 'game:acceptScore', gameId)).ok).toBe(true);
    expect((await emit(sw, 'game:acceptScore', gameId)).ok).toBe(true);
    const fin = await done;
    // Board is open below row 4, so neither side has territory: white wins by komi.
    expect(fin.state.result).toBe('W+6.5');
    expect(fin.ratingChange!.white).toBeGreaterThan(0);

    const sgf = await (await fetch(`${base}/api/games/${gameId}/sgf`)).text();
    expect(sgf).toContain('RE[W+6.5]');
    expect(sgf).toContain(';B[ca]');
    const profile = await (await fetch(`${base}/api/users/white1`)).json();
    expect(profile.user.gamesPlayed).toBe(1);
    expect(profile.games[0].result).toBe('W+6.5');
    const rec = await (await fetch(`${base}/api/games/${gameId}`)).json();
    expect(rec.moves).toHaveLength(12);
  });

  it('flags a player whose byo-yomi runs out', async () => {
    const b = await register('slowpoke');
    const w = await register('waiter');
    const sb = await connect(b.cookie);
    const sw = await connect(w.cookie);
    const created = await emit(sb, 'seek:create', {
      ...seek,
      rated: false,
      clock: { type: 'byoyomi', mainTime: 0, periods: 1, periodTime: 5_000 },
    });
    const { gameId } = await emit(sw, 'seek:accept', created.seek.id);
    await emit(sw, 'game:join', gameId);
    const fin = await nextUpdate(sw, (g) => g.state.phase === 'finished');
    expect(fin.state.result).toBe('W+T');
    expect(fin.ratingChange).toBeNull();
    void sb;
  });

  it('resigning ends the game and frees players for new seeks', async () => {
    const b = await register('quitter');
    const w = await register('winner');
    const sb = await connect(b.cookie);
    const sw = await connect(w.cookie);
    const created = await emit(sb, 'seek:create', seek);
    const { gameId } = await emit(sw, 'seek:accept', created.seek.id);
    expect((await emit(sb, 'seek:create', seek)).error).toBe('already_playing');
    await emit(sb, 'game:join', gameId);
    const fin = nextUpdate(sb, (g) => g.state.phase === 'finished');
    expect((await emit(sb, 'game:resign', gameId)).ok).toBe(true);
    expect((await fin).state.result).toBe('W+R');
    expect((await emit(sb, 'seek:create', seek)).ok).toBe(true);
  });
});

const ai: AiGameRequest = {
  size: 9,
  komi: 6.5,
  handicap: 0,
  ruleset: 'japanese',
  clock: { type: 'byoyomi', mainTime: 600_000, periods: 3, periodTime: 30_000 },
  black: null,
  white: 'stub',
};

describe('computer players', () => {
  // Registration is rate limited, so the tests below share one account.
  let h: { cookie: string };
  it('lists the engines with their bot accounts', async () => {
    const s = await connect();
    const r = await emit(s, 'ai:engines');
    expect(r.engines.map((e: any) => e.user.username)).toEqual(['AI-Lv1', 'AI-Stub']);
    expect(r.engines[0].user.bot).toBe(true);
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'AI-Stub', password: '!' }),
    });
    expect(login.status).toBe(401);
  });

  it('plays a person against the computer through to an agreed score', async () => {
    h = await register('human1');
    const s = await connect(h.cookie);
    expect((await emit(s, 'ai:start', { ...ai, black: null, white: null })).error).toBe('invalid_seek');
    expect((await emit(s, 'ai:start', { ...ai, white: 'nope' })).error).toBe('no_such_engine');
    const r = await emit(s, 'ai:start', ai);
    expect(r.ok).toBe(true);
    const joined = await emit(s, 'game:join', r.gameId);
    expect(joined.game.white.bot).toBe(true);
    expect(joined.game.rated).toBe(false);
    expect((await emit(s, 'seek:create', seek)).error).toBe('already_playing');

    // Black plays the right edge; the stub answers from the top-left each time.
    const replied = nextUpdate(s, (g) => g.state.moves.length === 2);
    expect((await emit(s, 'game:move', r.gameId, 8, 0)).ok).toBe(true);
    expect((await replied).state.moves[1]).toEqual({ c: 2, p: 0 });

    // A pass is answered with a pass; the computer then accepts the score, and so do we.
    const scoring = nextUpdate(s, (g) => g.state.phase === 'scoring' && g.state.accepted.length === 1);
    expect((await emit(s, 'game:pass', r.gameId, 2)).ok).toBe(true);
    expect((await scoring).state.accepted).toEqual([2]);
    const done = nextUpdate(s, (g) => g.state.phase === 'finished');
    expect((await emit(s, 'game:acceptScore', r.gameId)).ok).toBe(true);
    const fin = await done;
    expect(fin.state.result).toBe('W+6.5');
    expect(fin.ratingChange).toBeNull();
  });

  it('runs a game between two engines that anyone can watch', async () => {
    const s = await connect(h.cookie);
    const r = await emit(s, 'ai:start', { ...ai, black: 'builtin-1', white: 'builtin-1' });
    expect(r.ok).toBe(true);
    expect((await emit(s, 'ai:start', { ...ai, black: 'stub', white: 'builtin-1' })).error).toBe('too_many_ai_games');
    // Watching an engine game does not stop the owner from playing.
    expect((await emit(s, 'seek:create', seek)).ok).toBe(true);
    const viewer = await connect();
    const done = nextUpdate(viewer, (g) => g.state.phase === 'finished');
    expect((await emit(viewer, 'game:join', r.gameId)).ok).toBe(true);
    const fin = await done;
    expect(fin.state.moves.length).toBeGreaterThan(20);
    expect(fin.state.result).toMatch(/^[BW]\+/);
    const rec = await (await fetch(`${base}/api/games/${r.gameId}`)).json();
    expect(rec.status).toBe('finished');
    expect(Game.fromMoves(rec.settings, rec.moves).moves.length).toBe(fin.state.moves.length);
  }, 30_000);

  it('greets, answers chat and thanks its opponent', async () => {
    const s = await connect(h.cookie);
    const r = await emit(s, 'ai:start', { ...ai, black: 'stub', white: null });
    expect(r.ok).toBe(true);
    const joined = await emit(s, 'game:join', r.gameId);
    expect(joined.game.chat.map((m: any) => [m.user, m.text])).toEqual([['AI-Stub', 'よろしくお願いします。']]);
    const answer = new Promise<any>((res) => s.on('game:chat', (_id, m) => m.user === 'AI-Stub' && res(m)));
    expect((await emit(s, 'game:chat', r.gameId, 'ありがとう')).ok).toBe(true);
    expect((await answer).text).toBe('こちらこそ。');
    const thanks = new Promise<any>((res) => s.on('game:chat', (_id, m) => m.text === 'ありがとうございました。' && res(m)));
    expect((await emit(s, 'game:resign', r.gameId)).ok).toBe(true);
    expect((await thanks).user).toBe('AI-Stub');
  });
});
