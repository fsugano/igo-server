import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import {
  Ack,
  BLACK,
  ClientToServerEvents,
  GameSettings,
  PublicUser,
  ServerToClientEvents,
  WHITE,
  ratingForRank,
} from '@igo/shared';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { CannedChat, ChatContext, ChatResponder, LINES, chatResponder } from './ai/chat.js';
import { Engine, loadEngines } from './ai/index.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { BotOptions, GameService, LiveGame, buildSgf, copyGame } from './games.js';
import { Lobby, aiGameSchema, validHandicap } from './lobby.js';
import { UserRow, Users, toPublicUser, verifyPassword } from './users.js';

const SESSION_COOKIE = 'sid';

const registerSchema = z.object({
  username: z.string().regex(/^[A-Za-z0-9_]{3,16}$/),
  password: z.string().min(8).max(200),
  rank: z.string().regex(/^([1-9]|[12][0-9]|30)k$|^[1-9]d$/i),
});
const loginSchema = z.object({ username: z.string().max(32), password: z.string().max(200) });

type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, { user: PublicUser | null }>;

/** Games between two engines use CPU while nobody plays: keep them few. */
const MAX_AI_ONLY_GAMES = 4;
const MAX_AI_ONLY_GAMES_PER_USER = 1;

export interface AppOptions extends Omit<BotOptions, 'engines'> {
  /** Computer players. Default: the built-in levels plus AI_GTP_ENGINES. */
  engines?: Engine[];
  /** What computer players say in the chat. Default: Claude when ANTHROPIC_API_KEY is set, set phrases otherwise. */
  chat?: ChatResponder;
}

export async function buildApp(config: Config, db: Db, opts: AppOptions = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', trustProxy: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  const users = new Users(db);
  const lobby = new Lobby();

  const engineList = opts.engines ?? loadEngines();
  const engines = new Map(engineList.map((e) => [e.id, e]));
  const botUsers = new Map<string, UserRow>();
  for (const e of engineList) botUsers.set(e.id, await users.ensureBot(e.username, e.id, ratingForRank(e.rank)));
  const chat = opts.chat ?? chatResponder();
  const canned = new CannedChat();
  const maxChat = Number(process.env.AI_CHAT_MAX_PER_GAME ?? 30);
  const chatCounts = new Map<string, number>();
  const chatBusy = new Set<string>();
  app.log.info(`AI chat: ${chat.kind === 'claude' ? 'Claude API' : 'set phrases (no ANTHROPIC_API_KEY)'}`);
  const engineInfo = () =>
    engineList.map((e) => ({ id: e.id, label: e.label, user: toPublicUser(botUsers.get(e.id)!) }));
  const io = new Server<ClientToServerEvents, ServerToClientEvents, {}, { user: PublicUser | null }>(app.server, {
    serveClient: false,
  });

  const gameRoom = (id: string) => `game:${id}`;
  const userRoom = (id: string) => `user:${id}`;
  /** Viewers in the game room who are not one of the two players. */
  const spectators = (id: string) => {
    const g = games.live.get(id);
    let n = 0;
    for (const sid of io.sockets.adapter.rooms.get(gameRoom(id)) ?? []) {
      const uid = io.sockets.sockets.get(sid)?.data.user?.id;
      if (!g || (uid !== g.black.id && uid !== g.white.id)) n++;
    }
    return n;
  };

  let lobbyDirty = false;
  const broadcastLobby = () => {
    if (lobbyDirty) return;
    lobbyDirty = true;
    setTimeout(() => {
      lobbyDirty = false;
      io.to('lobby').emit('lobby:state', lobbyState());
    }, 100);
  };
  const lobbyState = () => lobby.state([...games.live.values()].map((g) => games.summary(g)));

  const games: GameService = new GameService(db, {
    update: (g) => io.to(gameRoom(g.id)).emit('game:update', games.view(g, spectators(g.id))),
    finished: async (g) => {
      const bot = g.black.bot ? g.black : g.white;
      if (bot.bot && !games.isAiOnly(g)) botSay(g.id, bot, LINES.thanks);
      chatCounts.delete(g.id);
      for (const id of [g.black.id, g.white.id]) {
        const u = await users.byId(id);
        if (u) lobby.updateUser(toPublicUser(u));
      }
      broadcastLobby();
    },
    error: (e) => app.log.error(e),
  }, Date.now, { engines, moveDelayMs: opts.moveDelayMs, aiVsAiDelayMs: opts.aiVsAiDelayMs });
  await games.loadActive();

  const cookieOpts = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.secureCookies,
    maxAge: config.sessionDays * 86400,
  };

  async function currentUser(req: FastifyRequest): Promise<UserRow | null> {
    return users.bySession(req.cookies[SESSION_COOKIE]);
  }

  async function startSession(reply: FastifyReply, user: UserRow) {
    const token = await users.createSession(user.id, config.sessionDays);
    reply.setCookie(SESSION_COOKIE, token, cookieOpts);
  }

  const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/auth/register', authLimit, async (req, reply) => {
    const p = registerSchema.safeParse(req.body);
    if (!p.success) {
      // Report the first bad field so the form can say what to fix.
      const field = p.error.issues[0]?.path[0];
      const error = field === 'username' || field === 'password' || field === 'rank' ? `invalid_${field}` : 'invalid_input';
      return reply.code(400).send({ error });
    }
    const u = await users.create(p.data.username, p.data.password, ratingForRank(p.data.rank));
    if (u === 'taken') return reply.code(409).send({ error: 'username_taken' });
    await startSession(reply, u);
    return { user: toPublicUser(u) };
  });

  app.post('/api/auth/login', authLimit, async (req, reply) => {
    const p = loginSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid_input' });
    const u = await users.byName(p.data.username);
    if (!u || !(await verifyPassword(p.data.password, u.password_hash))) {
      return reply.code(401).send({ error: 'bad_credentials' });
    }
    await startSession(reply, u);
    return { user: toPublicUser(u) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const t = req.cookies[SESSION_COOKIE];
    if (t) await users.deleteSession(t);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const u = await currentUser(req);
    return { user: u ? toPublicUser(u) : null };
  });

  app.get<{ Params: { username: string } }>('/api/users/:username', async (req, reply) => {
    const u = await users.byName(req.params.username);
    if (!u) return reply.code(404).send({ error: 'not_found' });
    const r = await db.query(
      `SELECT g.id, g.settings, g.rated, g.status, g.result, g.started_at, g.rating_change,
              b.username AS black, w.username AS white, jsonb_array_length(g.moves) AS move_count
       FROM games g JOIN users b ON b.id = g.black_id JOIN users w ON w.id = g.white_id
       WHERE g.black_id = $1 OR g.white_id = $1 ORDER BY g.started_at DESC LIMIT 50`,
      [u.id],
    );
    return {
      user: toPublicUser(u),
      games: r.rows.map((g) => ({
        id: String(g.id),
        black: g.black,
        white: g.white,
        size: g.settings.size,
        rated: g.rated,
        status: g.status,
        result: g.result,
        startedAt: new Date(g.started_at).getTime(),
        moveCount: g.move_count,
        ratingChange: g.rating_change,
      })),
    };
  });

  /** Finished-game record for replay. Active games are watched over the socket. */
  app.get<{ Params: { id: string } }>('/api/games/:id', async (req, reply) => {
    if (!/^\d+$/.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const r = await db.query(
      `SELECT g.*, row_to_json(b) AS b, row_to_json(w) AS w FROM games g
       JOIN users b ON b.id = g.black_id JOIN users w ON w.id = g.white_id WHERE g.id = $1`,
      [req.params.id],
    );
    const g = r.rows[0];
    if (!g) return reply.code(404).send({ error: 'not_found' });
    return {
      id: String(g.id),
      black: toPublicUser(g.b),
      white: toPublicUser(g.w),
      settings: g.settings,
      clock: g.clock_settings,
      rated: g.rated,
      status: g.status,
      result: g.result,
      moves: g.moves,
      ratingChange: g.rating_change,
      startedAt: new Date(g.started_at).getTime(),
    };
  });

  app.get<{ Params: { id: string } }>('/api/games/:id/sgf', async (req, reply) => {
    if (!/^\d+$/.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const live = games.live.get(req.params.id);
    let sgf: string;
    if (live) sgf = games.sgf(live);
    else {
      const r = await db.query(
        `SELECT g.*, b.username AS bn, w.username AS wn FROM games g
         JOIN users b ON b.id = g.black_id JOIN users w ON w.id = g.white_id WHERE g.id = $1`,
        [req.params.id],
      );
      const g = r.rows[0];
      if (!g) return reply.code(404).send({ error: 'not_found' });
      sgf =
        g.sgf ??
        buildSgf({
          settings: g.settings,
          moves: g.moves,
          clock: g.clock_settings,
          black: g.bn,
          white: g.wn,
          blackRating: g.black_rating,
          whiteRating: g.white_rating,
          result: g.result,
          startedAt: new Date(g.started_at).getTime(),
        });
    }
    return reply
      .header('content-type', 'application/x-go-sgf; charset=utf-8')
      .header('content-disposition', `attachment; filename="igo-${req.params.id}.sgf"`)
      .send(sgf);
  });

  if (config.webDist && existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/socket.io/')) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
  }

  // ---- Socket.IO ----

  io.use(async (socket, next) => {
    try {
      const token = app.parseCookie(socket.handshake.headers.cookie ?? '')[SESSION_COOKIE];
      const u = await users.bySession(token);
      socket.data.user = u ? toPublicUser(u) : null;
      next();
    } catch (e) {
      next(e as Error);
    }
  });

  io.on('connection', (socket: IoSocket) => {
    const me = socket.data.user;
    if (me) {
      lobby.connect(me);
      socket.join(userRoom(me.id));
      broadcastLobby();
    }
    const needUser = (ack: (r: { ok: false; error: string }) => void) => {
      if (!me) ack({ ok: false, error: 'login_required' });
      return me;
    };
    const safe =
      <A extends unknown[]>(fn: (...args: A) => unknown) =>
      (...args: A) => {
        const ack = args[args.length - 1];
        if (typeof ack !== 'function') return;
        Promise.resolve()
          .then(() => fn(...args))
          .catch((e) => {
            app.log.error(e);
            (ack as (r: unknown) => void)({ ok: false, error: 'server_error' });
          });
      };

    socket.on('lobby:join', safe((ack) => {
      socket.join('lobby');
      ack({ ok: true, lobby: lobbyState() });
    }));
    socket.on('lobby:leave', () => void socket.leave('lobby'));

    socket.on('seek:create', safe((req, ack) => {
      const u = needUser(ack);
      if (!u) return;
      if (userInGame(u.id)) return ack({ ok: false, error: 'already_playing' });
      const s = lobby.createSeek(u, req);
      if (typeof s === 'string') return ack({ ok: false, error: s });
      ack({ ok: true, seek: s });
      broadcastLobby();
    }));

    socket.on('seek:cancel', safe((seekId, ack) => {
      const u = needUser(ack);
      if (!u) return;
      if (!lobby.cancelSeek(u.id, String(seekId))) return ack({ ok: false, error: 'no_such_seek' });
      ack({ ok: true });
      broadcastLobby();
    }));

    socket.on('seek:accept', safe(async (seekId, ack) => {
      const u = needUser(ack);
      if (!u) return;
      if (userInGame(u.id)) return ack({ ok: false, error: 'already_playing' });
      const s = lobby.takeSeek(u.id, String(seekId));
      if (typeof s === 'string') return ack({ ok: false, error: s });
      const [creator, accepter] = await Promise.all([users.byId(s.creator.id), users.byId(u.id)]);
      if (!creator || !accepter) return ack({ ok: false, error: 'no_such_user' });
      const creatorBlack = s.color === 'black' || (s.color === 'random' && Math.random() < 0.5);
      const settings: GameSettings = { size: s.size, komi: s.komi, handicap: s.handicap, ruleset: s.ruleset };
      const g = await games.create({
        black: creatorBlack ? creator : accepter,
        white: creatorBlack ? accepter : creator,
        settings,
        clock: s.clock,
        rated: s.rated,
      });
      // A player in a game should not have other open seeks.
      for (const [id, other] of lobby.seeks) {
        if (other.creator.id === creator.id || other.creator.id === accepter.id) lobby.seeks.delete(id);
      }
      io.to(userRoom(g.black.id)).to(userRoom(g.white.id)).emit('game:start', g.id);
      ack({ ok: true, gameId: g.id });
      broadcastLobby();
    }));

    socket.on('ai:engines', safe((ack) => ack({ ok: true, engines: engineInfo() })));

    socket.on('ai:start', safe(async (req, ack) => {
      const u = needUser(ack);
      if (!u) return;
      const p = aiGameSchema.safeParse(req);
      if (!p.success || !validHandicap(p.data.size, p.data.handicap)) return ack({ ok: false, error: 'invalid_seek' });
      const r = p.data;
      const people = [r.black, r.white].filter((x) => x === null).length;
      if (people === 2) return ack({ ok: false, error: 'invalid_seek' });
      for (const id of [r.black, r.white]) if (id !== null && !botUsers.has(id)) return ack({ ok: false, error: 'no_such_engine' });
      if (people === 1 && userInGame(u.id)) return ack({ ok: false, error: 'already_playing' });
      if (people === 0) {
        const aiOnly = [...games.live.values()].filter((g) => games.isAiOnly(g));
        if (aiOnly.filter((g) => g.owner === u.id).length >= MAX_AI_ONLY_GAMES_PER_USER) {
          return ack({ ok: false, error: 'too_many_ai_games' });
        }
        if (aiOnly.length >= MAX_AI_ONLY_GAMES) return ack({ ok: false, error: 'server_busy' });
      }
      const me = await users.byId(u.id);
      if (!me) return ack({ ok: false, error: 'no_such_user' });
      const side = (id: string | null) => (id === null ? me : botUsers.get(id)!);
      const g = await games.create({
        black: side(r.black),
        white: side(r.white),
        settings: { size: r.size, komi: r.komi, handicap: r.handicap, ruleset: r.ruleset },
        clock: r.clock,
        rated: false,
        owner: people === 0 ? u.id : undefined,
      });
      if (people === 1) {
        for (const [id, s] of lobby.seeks) if (s.creator.id === u.id) lobby.seeks.delete(id);
        botSay(g.id, r.black ? g.black : g.white, LINES.greeting);
      }
      ack({ ok: true, gameId: g.id });
      broadcastLobby();
    }));

    socket.on('game:join', safe(async (gameId, ack) => {
      const g = games.live.get(String(gameId));
      if (!g) return ack({ ok: false, error: 'no_such_game' });
      await socket.join(gameRoom(g.id));
      ack({ ok: true, game: games.view(g, spectators(g.id)) });
    }));
    socket.on('game:leave', (gameId) => void socket.leave(gameRoom(String(gameId))));

    const gameAction =
      <A extends unknown[]>(fn: (u: PublicUser, gameId: string, ...rest: A) => Promise<{ ok: true } | { ok: false; error: string }>) =>
      safe(async (gameId: string, ...rest: [...A, Ack]) => {
        const ack = rest.pop() as Ack;
        const u = needUser(ack);
        if (!u) return;
        ack(await fn(u, String(gameId), ...(rest as unknown as A)));
      });

    socket.on('game:move', gameAction((u, id, point: number, moveNumber: number) =>
      games.move(id, u.id, Number(point), Number(moveNumber)),
    ));
    socket.on('game:pass', gameAction((u, id, moveNumber: number) => games.pass(id, u.id, Number(moveNumber))));
    socket.on('game:resign', gameAction((u, id) => games.resign(id, u.id)));
    socket.on('game:toggleDead', gameAction((u, id, point: number) => games.toggleDead(id, u.id, Number(point))));
    socket.on('game:acceptScore', gameAction((u, id) => games.acceptScore(id, u.id)));
    socket.on('game:resume', gameAction((u, id) => games.resume(id, u.id)));

    socket.on('game:chat', safe((gameId, text, ack) => {
      const u = needUser(ack);
      if (!u) return;
      const msg = games.chat(String(gameId), u, String(text));
      if (!msg) return ack({ ok: false, error: 'invalid_chat' });
      io.to(gameRoom(String(gameId))).emit('game:chat', String(gameId), msg);
      ack({ ok: true });
      const g = games.live.get(String(gameId));
      if (g) void answerChat(g, u);
    }));

    socket.on('disconnect', () => {
      if (me && lobby.disconnect(me.id)) broadcastLobby();
    });
  });

  /** Posts a computer player's chat line. Works after the game has ended, when it is no longer live. */
  function botSay(gameId: string, bot: PublicUser, text: string) {
    const msg = games.chat(gameId, bot, text) ?? { user: bot.username, text, at: Date.now() };
    io.to(gameRoom(gameId)).emit('game:chat', gameId, msg);
  }

  /** Lets the computer answer its opponent's chat, one reply at a time and at most AI_CHAT_MAX_PER_GAME per game. */
  async function answerChat(g: LiveGame, speaker: PublicUser) {
    const color = games.colorOf(g, speaker.id);
    if (!color) return;
    const botColor = color === BLACK ? WHITE : BLACK;
    const bot = botColor === BLACK ? g.black : g.white;
    if (!bot.bot || chatBusy.has(g.id)) return;
    const n = chatCounts.get(g.id) ?? 0;
    if (n > maxChat) return;
    chatCounts.set(g.id, n + 1);
    if (n === maxChat) return botSay(g.id, bot, LINES.tired);
    chatBusy.add(g.id);
    try {
      const ctx: ChatContext = {
        game: copyGame(g.game),
        botColor,
        botName: bot.username,
        opponentName: speaker.username,
        history: g.chat.slice(-20),
      };
      let text: string | null;
      try {
        text = await chat.reply(ctx);
      } catch (e) {
        app.log.error(e);
        text = await canned.reply(ctx);
      }
      if (text) botSay(g.id, bot, text);
    } finally {
      chatBusy.delete(g.id);
    }
  }

  function userInGame(userId: string): LiveGame | undefined {
    for (const g of games.live.values()) if (g.black.id === userId || g.white.id === userId) return g;
    return undefined;
  }

  app.addHook('onClose', async () => {
    games.stop();
    io.close();
  });

  return { app, io, games, lobby };
}
