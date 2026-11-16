import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import {
  Ack,
  BLACK,
  DECLARED_RANK_GAMES,
  ClientToServerEvents,
  Game,
  GameSettings,
  GaugeState,
  NewsItem,
  PublicUser,
  RECORDING_METHODS,
  Role,
  SeekRequest,
  ServerToClientEvents,
  StatsGame,
  WHITE,
  checkDisplayName,
  gamesForLevel,
  judgeStyle,
  levelFor,
  playerRecord,
  ratingForRank,
} from '@igo/shared';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { BuiltinEvaluator, Evaluator, GaugeService } from './ai/gauge.js';
import { CannedChat, ChatContext, ChatResponder, LINES, chatResponder } from './ai/chat.js';
import { Engine, loadEngines } from './ai/index.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { BotOptions, GameService, LiveGame, buildSgf, copyGame } from './games.js';
import { AVATAR_FILE, AVATAR_MAX_BYTES, removeAvatar, saveAvatar } from './avatars.js';
import { Challenges } from './challenges.js';
import { Lobby, aiGameSchema, validHandicap } from './lobby.js';
import { LobbyChat } from './lobby-chat.js';
import { News, newsSchema } from './news.js';
import { Settings } from './settings.js';
import { Social } from './social.js';
import { EventLimiter, originAllowed } from './socket-guard.js';
import { UserRow, Users, dummyHash, toPublicUser, userJson, verifyPassword } from './users.js';

const SESSION_COOKIE = 'sid';
/** Finished games the record and style are computed from (the latest ones). */
const STATS_GAMES = 300;

const registerSchema = z.object({
  username: z.string().regex(/^[A-Za-z0-9_]{3,16}$/),
  password: z.string().min(8).max(200),
  rank: z.string().regex(/^([1-9]|[12][0-9]|30)k$|^[1-9]d$/i),
});
const loginSchema = z.object({ username: z.string().max(32), password: z.string().max(200) });
const accountSettingsSchema = z.object({ allowRecording: z.boolean() }).strict();
const profileSchema = z
  .object({
    displayName: z.string().max(100).optional(),
    declaredRank: registerSchema.shape.rank.optional(),
  })
  .strict();

type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, { user: PublicUser | null }>;

/** Games between two engines use CPU while nobody plays: keep them few. */
const MAX_AI_ONLY_GAMES = 4;
const MAX_AI_ONLY_GAMES_PER_USER = 1;
/** People playing the computer at once (each game keeps a CPU core busy while the computer thinks). */
const MAX_PERSON_AI_GAMES = Number(process.env.AI_MAX_GAMES ?? 20);
/** How often expired sessions are removed. */
const SESSION_SWEEP_MS = 60 * 60 * 1000;
/** How often scheduled news is checked. */
const NEWS_CHECK_MS = 30_000;

export interface AppOptions extends Omit<BotOptions, 'engines'> {
  /** Computer players. Default: the built-in levels plus AI_GTP_ENGINES. */
  engines?: Engine[];
  /** Judges positions for the spectators' gauge. Default: the built-in search. */
  evaluator?: Evaluator;
  /** What computer players say in the chat. Default: Claude when ANTHROPIC_API_KEY is set, set phrases otherwise. */
  chat?: ChatResponder;
}

export async function buildApp(config: Config, db: Db, opts: AppOptions = {}) {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    // Fastify accepts a hop count too, though its types leave it out.
    trustProxy: config.trustProxy as boolean | string,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // React sets style attributes (board size, gauge width).
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    // Recorded videos are made from this same tab; nothing is embedded from other sites.
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: AVATAR_MAX_BYTES, files: 1, fields: 0, parts: 1 } });

  const users = new Users(db);
  const lobby = new Lobby();
  const lobbyChat = new LobbyChat(db);
  const social = new Social(db);
  const news = new News(db);
  const settings = new Settings(db);
  await settings.load();

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
    allowRequest: (req, cb) => cb(null, originAllowed(req, config.allowedOrigins, config.secureCookies)),
  });
  const limiter = new EventLimiter();

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

  // ---- Evaluation gauge ----
  // Players never receive it; spectators see it a few moves late in games a person plays in.
  const gaugeRoom = (id: string) => `gauge:${id}`;
  const gaugeWatchers = (id: string) => io.sockets.adapter.rooms.get(gaugeRoom(id))?.size ?? 0;
  const gaugeDelay = (g: LiveGame) => (games.isAiOnly(g) ? 0 : settings.get().liveDelayMoves);
  const gaugeState = (g: LiveGame, final = false): GaugeState => {
    const delay = final ? 0 : gaugeDelay(g);
    return { gameId: g.id, delay, evals: gauge.visible(g.id, g.game.moves.length, delay), engine: gauge.evaluator.id, final };
  };
  const emitGauge = (g: LiveGame, final = false) => io.to(gaugeRoom(g.id)).emit('gauge:update', gaugeState(g, final));
  const gauge = new GaugeService(
    opts.evaluator ?? new BuiltinEvaluator(),
    (gameId) => {
      const g = games.live.get(gameId);
      if (g) emitGauge(g);
    },
    (e) => app.log.error(e),
  );
  /** Queues the positions a spectator needs: the one they may see now, and the current one for later. */
  const requestGauge = (g: LiveGame) => {
    const n = g.game.moves.length;
    const shown = Math.max(0, n - gaugeDelay(g));
    if (shown < n) gauge.request(g.id, shown, Game.fromMoves(g.game.settings, g.game.moves.slice(0, shown)));
    if (g.game.phase === 'playing') gauge.request(g.id, n, copyGame(g.game));
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
  const lobbyState = () =>
    lobby.state(
      [...games.live.values()].map((g) => games.summary(g)),
      (userId) => {
        const g = userInGame(userId);
        return g && { gameId: g.id, vsBot: g.black.bot || g.white.bot };
      },
    );

  const challenges = new Challenges({
    received: (c) => io.to(userRoom(c.to.id)).to(userRoom(c.from.id)).emit('challenge:received', c),
    updated: (c, u) => io.to(userRoom(c.to.id)).to(userRoom(c.from.id)).emit('challenge:updated', u),
  });

  const games: GameService = new GameService(db, {
    update: (g) => {
      io.to(gameRoom(g.id)).emit('game:update', games.view(g, spectators(g.id)));
      if (gaugeWatchers(g.id) && g.game.phase !== 'finished') {
        emitGauge(g);
        requestGauge(g);
      }
    },
    finished: async (g) => {
      // Once the game is over nothing is hidden any more.
      if (gaugeWatchers(g.id)) emitGauge(g, true);
      gauge.forget(g.id);
      const bot = g.black.bot ? g.black : g.white;
      if (bot.bot && !games.isAiOnly(g)) botSay(g.id, bot, LINES.thanks);
      chatCounts.delete(g.id);
      // New rating and level.
      for (const id of [g.black.id, g.white.id]) {
        const u = await users.byId(id);
        if (u && !u.bot) userChanged(u);
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

  /** Replies 401/403 and returns null unless the requester has one of the roles. */
  async function requireRole(req: FastifyRequest, reply: FastifyReply, roles: Role[]): Promise<UserRow | null> {
    const u = await currentUser(req);
    if (!u) {
      reply.code(401).send({ error: 'login_required' });
      return null;
    }
    if (!roles.includes(u.role)) {
      reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    return u;
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
    const u = await users.create(p.data.username, p.data.password, ratingForRank(p.data.rank), p.data.rank.toLowerCase());
    if (u === 'taken') return reply.code(409).send({ error: 'username_taken' });
    await startSession(reply, u);
    return { user: toPublicUser(u) };
  });

  app.post('/api/auth/login', authLimit, async (req, reply) => {
    const p = loginSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid_input' });
    const cred = await users.credentials(p.data.username);
    // Check a password even for unknown names, so the response time does not tell which names exist.
    const ok = await verifyPassword(p.data.password, cred?.passwordHash ?? (await dummyHash()));
    const u = cred?.user;
    if (!u || !ok) {
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
    return { user: u ? toPublicUser(u) : null, account: u ? { role: u.role, allowRecording: u.allow_recording } : null };
  });

  app.patch('/api/me/settings', async (req, reply) => {
    const u = await currentUser(req);
    if (!u) return reply.code(401).send({ error: 'login_required' });
    const p = accountSettingsSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid_input' });
    await users.setAllowRecording(u.id, p.data.allowRecording);
    return { account: { role: u.role, allowRecording: p.data.allowRecording } };
  });

  // ---- Profile ----

  /** What the profile editor shows. */
  const profileOf = (u: UserRow) => {
    const level = levelFor(u.games_completed);
    const changed = u.display_name_changed_at ? new Date(u.display_name_changed_at).getTime() : 0;
    return {
      displayName: u.display_name,
      declaredRank: u.declared_rank,
      /** When the nickname may be changed again (ms), null if now. */
      nameChangeAt: changed && changed + 86_400_000 > Date.now() ? changed + 86_400_000 : null,
      /** Whether changing the declared rank still resets the rating. */
      rankResetsRating: u.games_played < DECLARED_RANK_GAMES,
      gamesCompleted: u.games_completed,
      level,
      nextLevelAt: gamesForLevel(level + 1),
    };
  };
  /** Shows a change in the lobby and in the person's other tabs. */
  const userChanged = (u: UserRow) => {
    const pu = toPublicUser(u);
    lobby.updateUser(pu);
    io.to(userRoom(pu.id)).emit('user:updated', pu);
    broadcastLobby();
    return pu;
  };

  app.get('/api/me/profile', async (req, reply) => {
    const u = await currentUser(req);
    if (!u) return reply.code(401).send({ error: 'login_required' });
    return { user: toPublicUser(u), profile: profileOf(u) };
  });

  app.patch('/api/me/profile', async (req, reply) => {
    let u = await currentUser(req);
    if (!u) return reply.code(401).send({ error: 'login_required' });
    const p = profileSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid_input' });
    if (p.data.displayName !== undefined) {
      const c = checkDisplayName(p.data.displayName);
      if ('error' in c) return reply.code(400).send({ error: c.error });
      if (c.name !== u.display_name) {
        const r = await users.setDisplayName(u.id, c.name);
        if (typeof r === 'string') return reply.code(429).send({ error: r });
        u = r;
      }
    }
    if (p.data.declaredRank !== undefined) {
      const rank = p.data.declaredRank.toLowerCase();
      u = (await users.setDeclaredRank(u.id, rank, ratingForRank(rank), DECLARED_RANK_GAMES)) ?? u;
    }
    return { user: userChanged(u), profile: profileOf(u) };
  });

  // At most 10 uploads a day per account (each one is decoded and re-encoded).
  const avatarLimit = {
    config: {
      rateLimit: { max: 10, timeWindow: '1 day', keyGenerator: (req: FastifyRequest) => req.cookies[SESSION_COOKIE] ?? req.ip },
    },
  };

  app.post('/api/me/avatar', avatarLimit, async (req, reply) => {
    const u = await currentUser(req);
    if (!u) return reply.code(401).send({ error: 'login_required' });
    let data: Buffer;
    try {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'invalid_image' });
      data = await file.toBuffer();
    } catch (e) {
      if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'image_too_large' });
      return reply.code(400).send({ error: 'invalid_image' });
    }
    const id = await saveAvatar(config.uploadDir, data);
    if (typeof id !== 'string') return reply.code(400).send({ error: id.error });
    const old = await users.setAvatar(u.id, id);
    await removeAvatar(config.uploadDir, old);
    const row = (await users.byId(u.id))!;
    return { user: userChanged(row) };
  });

  app.delete('/api/me/avatar', async (req, reply) => {
    const u = await currentUser(req);
    if (!u) return reply.code(401).send({ error: 'login_required' });
    const old = await users.setAvatar(u.id, null);
    await removeAvatar(config.uploadDir, old);
    const row = (await users.byId(u.id))!;
    return { user: userChanged(row) };
  });

  /** Profile pictures. Names are random ids, new for each upload, so they are cached for good. */
  app.get<{ Params: { file: string } }>('/avatars/:file', async (req, reply) => {
    const f = req.params.file;
    if (!AVATAR_FILE.test(f)) return reply.code(404).send({ error: 'not_found' });
    const path = join(config.uploadDir, f);
    if (!existsSync(path)) return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('content-type', 'image/webp')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(createReadStream(path));
  });

  // ---- News ----

  const publicCache = (reply: FastifyReply) => reply.header('cache-control', 'public, max-age=60');

  app.get<{ Querystring: { category?: string; before?: string } }>('/api/news', async (req, reply) => {
    const c = req.query.category;
    if (c && !['info', 'maintenance', 'update', 'event'].includes(c)) return reply.code(400).send({ error: 'invalid_input' });
    publicCache(reply);
    return news.list(c, req.query.before);
  });

  app.get('/api/news/important', async (_req, reply) => {
    // Not cached: the banner must show an urgent item at once.
    reply.header('cache-control', 'no-cache');
    return { items: await news.important() };
  });

  app.get('/api/news/unread-count', async (req, reply) => {
    const u = await currentUser(req);
    if (!u) return reply.code(401).send({ error: 'login_required' });
    return { count: await news.unreadCount(u.id) };
  });

  app.post('/api/news/read', async (req, reply) => {
    const u = await currentUser(req);
    if (!u) return reply.code(401).send({ error: 'login_required' });
    await news.markRead(u.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/news/:id', async (req, reply) => {
    const item = await news.get(req.params.id);
    if (!item) return reply.code(404).send({ error: 'not_found' });
    publicCache(reply);
    return { item };
  });

  // Operators' news. Each change is written to the audit log.
  const adminLimit = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  /** Tells the people online about items that have become visible. */
  const announce = (items: NewsItem[]) => {
    // Without the body: it is fetched when opened. (An item may be announced twice; the page keeps one per id.)
    for (const { body: _body, ...item } of items) io.emit('news:published', item);
  };
  const visibleNow = (n: { publishAt: number | null; expireAt: number | null }) =>
    n.publishAt !== null && n.publishAt <= Date.now() && (n.expireAt === null || n.expireAt > Date.now());

  app.get('/api/admin/news', adminLimit, async (req, reply) => {
    if (!(await requireRole(req, reply, ['admin']))) return;
    return { items: await news.all() };
  });

  app.post('/api/admin/news', adminLimit, async (req, reply) => {
    const u = await requireRole(req, reply, ['admin']);
    if (!u) return;
    const p = newsSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid_news' });
    const item = await news.create(p.data, u.id);
    await news.audit(u.id, 'news.create', item.id, { title: item.title, publishAt: item.publishAt });
    if (visibleNow(item)) announce([item]);
    return { item };
  });

  app.patch<{ Params: { id: string } }>('/api/admin/news/:id', adminLimit, async (req, reply) => {
    const u = await requireRole(req, reply, ['admin']);
    if (!u) return;
    const p = newsSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid_news' });
    const before = await news.get(req.params.id, true);
    const item = await news.update(req.params.id, p.data);
    if (!item) return reply.code(404).send({ error: 'not_found' });
    await news.audit(u.id, 'news.update', item.id, { title: item.title, publishAt: item.publishAt });
    if (visibleNow(item) && !(before && visibleNow(before))) announce([item]);
    return { item };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/news/:id', adminLimit, async (req, reply) => {
    const u = await requireRole(req, reply, ['admin']);
    if (!u) return;
    const item = await news.get(req.params.id, true);
    if (!item || !(await news.remove(item.id))) return reply.code(404).send({ error: 'not_found' });
    await news.audit(u.id, 'news.delete', item.id, { title: item.title });
    return { ok: true };
  });

  // Items scheduled for later are announced when their time comes.
  let newsCheckedAt = new Date();
  const checkScheduled = async () => {
    const since = newsCheckedAt;
    newsCheckedAt = new Date();
    announce(await news.publishedBetween(since));
  };
  const newsTimer = setInterval(() => void checkScheduled().catch((e) => app.log.error(e)), NEWS_CHECK_MS);
  newsTimer.unref();

  // ---- Operators ----

  app.get('/api/admin/settings', async (req, reply) => {
    if (!(await requireRole(req, reply, ['staff', 'admin']))) return;
    return { settings: settings.get(), recordingMethods: RECORDING_METHODS };
  });

  app.patch('/api/admin/settings', async (req, reply) => {
    const u = await requireRole(req, reply, ['admin']);
    if (!u) return;
    const next = await settings.update(req.body, u.id);
    if (!next) return reply.code(400).send({ error: 'invalid_settings' });
    app.log.info({ by: u.username, settings: next }, 'settings changed');
    // Spectators see the new delay straight away.
    for (const g of games.live.values()) if (gaugeWatchers(g.id)) emitGauge(g);
    return { settings: next, recordingMethods: RECORDING_METHODS };
  });

  /** What the recording mode needs besides the game itself: the method, and who agreed to be shown by name. */
  app.get<{ Params: { id: string } }>('/api/admin/broadcast/:id', async (req, reply) => {
    if (!(await requireRole(req, reply, ['staff', 'admin']))) return;
    const g = games.live.get(req.params.id);
    if (!g) return reply.code(404).send({ error: 'not_found' });
    const consent = async (id: string) => {
      const u = await users.byId(id);
      return !!u && (!!u.bot || u.allow_recording);
    };
    const [black, white] = await Promise.all([consent(g.black.id), consent(g.white.id)]);
    return { recordingMethod: settings.get().recordingMethod, consent: { black, white } };
  });

  /** Record and playing style from the latest finished games. */
  app.get<{ Params: { username: string } }>('/api/users/:username/stats', async (req, reply) => {
    const u = await users.byName(req.params.username);
    if (!u) return reply.code(404).send({ error: 'not_found' });
    const r = await db.query(
      `SELECT g.id, g.black_id, g.settings, g.rated, g.result, g.started_at, g.moves, g.rating_change,
              g.black_rating, g.white_rating, b.username AS black, w.username AS white, b.bot AS black_bot, w.bot AS white_bot
       FROM games g JOIN users b ON b.id = g.black_id JOIN users w ON w.id = g.white_id
       WHERE (g.black_id = $1 OR g.white_id = $1) AND g.status = 'finished' AND g.result IS NOT NULL
       ORDER BY g.started_at DESC LIMIT $2`,
      [u.id, STATS_GAMES],
    );
    const games: StatsGame[] = r.rows.map((g) => {
      const black = String(g.black_id) === String(u.id);
      return {
        id: String(g.id),
        color: black ? BLACK : WHITE,
        opponent: black ? g.white : g.black,
        vsBot: !!(black ? g.white_bot : g.black_bot),
        rated: g.rated,
        settings: g.settings,
        result: g.result,
        startedAt: new Date(g.started_at).getTime(),
        moves: g.moves,
        ratingBefore: black ? g.black_rating : g.white_rating,
        ratingChange: g.rating_change ? (black ? g.rating_change.black : g.rating_change.white) : null,
      };
    });
    return { games: games.length, limit: STATS_GAMES, record: playerRecord(games), style: judgeStyle(games) };
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
    const viewer = await currentUser(req);
    return {
      user: toPublicUser(u),
      declaredRank: u.declared_rank,
      gamesCompleted: u.games_completed,
      follows: await social.counts(u.id),
      following: viewer && viewer.id !== u.id ? await social.isFollowing(viewer.id, u.id) : null,
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
      `SELECT g.*, ${userJson('b')} AS b, ${userJson('w')} AS w FROM games g
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
    // Limits count per account when logged in, so several tabs or connections share them.
    const limitKey = me ? `u${me.id}` : `s${socket.id}`;
    socket.use(([event, ...args], next) => {
      if (limiter.allow(limitKey, String(event))) return next();
      const ack = args[args.length - 1];
      if (typeof ack === 'function') ack({ ok: false, error: 'rate_limited' });
    });
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

    socket.on('lobby:join', safe(async (ack) => {
      socket.join('lobby');
      // The chat is for members: visitors who are not logged in do not get it.
      ack({ ok: true, lobby: lobbyState(), chat: me ? await lobbyChat.recent() : [] });
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
      if (userInGame(u.id) || starting.has(u.id)) return ack({ ok: false, error: 'already_playing' });
      const wanted = lobby.seeks.get(String(seekId));
      if (wanted && starting.has(wanted.creator.id)) return ack({ ok: false, error: 'already_playing' });
      const s = lobby.takeSeek(u.id, String(seekId));
      if (typeof s === 'string') return ack({ ok: false, error: s });
      const g = await startGame(s.creator.id, u.id, s);
      if (typeof g === 'string') return ack({ ok: false, error: g });
      ack({ ok: true, gameId: g.id });
    }));

    // ---- Challenges: a game offered to one particular person ----

    socket.on('challenge:list', safe((ack) => {
      const u = needUser(ack);
      if (!u) return;
      ack({ ok: true, challenges: challenges.list(u.id) });
    }));

    socket.on('challenge:create', safe((userId, req, ack) => {
      const u = needUser(ack);
      if (!u) return;
      if (userInGame(u.id) || starting.has(u.id)) return ack({ ok: false, error: 'already_playing' });
      const target = lobby.onlineUser(String(userId));
      if (!target) return ack({ ok: false, error: 'user_offline' });
      if (userInGame(target.id) || starting.has(target.id)) return ack({ ok: false, error: 'opponent_playing' });
      if (lobby.isBusy(target.id)) return ack({ ok: false, error: 'opponent_busy' });
      const c = challenges.create(u, target, req);
      if (typeof c === 'string') return ack({ ok: false, error: c });
      ack({ ok: true, challenge: c });
    }));

    socket.on('challenge:cancel', safe((id, ack) => {
      const u = needUser(ack);
      if (!u) return;
      const r = challenges.cancel(u.id, String(id));
      ack(r === true ? { ok: true } : { ok: false, error: r });
    }));

    socket.on('challenge:respond', safe(async (id, answer, detail, ack) => {
      const u = needUser(ack);
      if (!u) return;
      const d = (detail ?? {}) as { reason?: unknown; request?: unknown };
      if (answer === 'decline') {
        const r = challenges.decline(u.id, String(id), typeof d.reason === 'string' ? d.reason : undefined);
        return ack(r === true ? { ok: true } : { ok: false, error: r });
      }
      if (answer === 'counter') {
        const c = challenges.counter(u.id, String(id), d.request);
        return ack(typeof c === 'string' ? { ok: false, error: c } : { ok: true, challenge: c });
      }
      if (answer !== 'accept') return ack({ ok: false, error: 'invalid_input' });
      if (userInGame(u.id) || starting.has(u.id)) return ack({ ok: false, error: 'already_playing' });
      const c = challenges.take(u.id, String(id));
      if (typeof c === 'string') return ack({ ok: false, error: c });
      if (!lobby.isOnline(c.from.id)) {
        challenges.finish(c, { id: c.id, outcome: 'cancelled' });
        return ack({ ok: false, error: 'user_offline' });
      }
      const g = await startGame(c.from.id, u.id, c.request).catch((e) => {
        challenges.restore(c);
        throw e;
      });
      if (typeof g === 'string') {
        challenges.restore(c);
        return ack({ ok: false, error: g === 'already_playing' ? 'opponent_playing' : g });
      }
      challenges.finish(c, { id: c.id, outcome: 'accepted', gameId: g.id });
      ack({ ok: true, gameId: g.id });
    }));

    // ---- Lobby chat ----

    socket.on('lobbychat:send', safe(async (text, ack) => {
      const u = needUser(ack);
      if (!u) return;
      if (!socket.rooms.has('lobby')) return ack({ ok: false, error: 'not_in_lobby' });
      const msg = await lobbyChat.post(u, text);
      if (!msg) return ack({ ok: false, error: 'invalid_chat' });
      io.to('lobby').emit('lobbychat:message', msg);
      ack({ ok: true });
    }));

    // ---- Follows and messages between two people ----

    socket.on('follow:list', safe(async (ack) => {
      const u = needUser(ack);
      if (!u) return;
      ack({ ok: true, ids: await social.following(u.id) });
    }));

    socket.on('follow:set', safe(async (userId, follow, ack) => {
      const u = needUser(ack);
      if (!u) return;
      const err = await social.setFollow(u.id, String(userId), !!follow);
      ack(err ? { ok: false, error: err } : { ok: true });
    }));

    socket.on('dm:conversations', safe(async (ack) => {
      const u = needUser(ack);
      if (!u) return;
      ack({ ok: true, conversations: await social.conversations(u.id) });
    }));

    socket.on('dm:history', safe(async (userId, ack) => {
      const u = needUser(ack);
      if (!u) return;
      const other = await social.recipient(u.id, String(userId));
      if (typeof other === 'string') return ack({ ok: false, error: other });
      await social.markRead(u.id, other.id);
      ack({ ok: true, user: other, messages: await social.history(u.id, other.id) });
    }));

    socket.on('dm:read', safe(async (userId, ack) => {
      const u = needUser(ack);
      if (!u) return;
      const id = String(userId);
      if (!/^\d{1,18}$/.test(id)) return ack({ ok: false, error: 'no_such_user' });
      await social.markRead(u.id, id);
      ack({ ok: true });
    }));

    socket.on('dm:send', safe(async (userId, text, ack) => {
      const u = needUser(ack);
      if (!u) return;
      const other = await social.recipient(u.id, String(userId));
      if (typeof other === 'string') return ack({ ok: false, error: other });
      const msg = await social.send(u.id, other.id, text);
      if (!msg) return ack({ ok: false, error: 'invalid_chat' });
      io.to(userRoom(u.id)).to(userRoom(other.id)).emit('dm:message', msg, u);
      ack({ ok: true, message: msg });
    }));

    socket.on('presence:setStatus', safe((status, ack) => {
      const u = needUser(ack);
      if (!u) return;
      if (status !== 'available' && status !== 'busy') return ack({ ok: false, error: 'invalid_input' });
      lobby.setBusy(u.id, status === 'busy');
      ack({ ok: true });
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
      if (people === 1 && (userInGame(u.id) || starting.has(u.id))) return ack({ ok: false, error: 'already_playing' });
      if (people === 1) {
        const withPerson = [...games.live.values()].filter((g) => !games.isAiOnly(g) && (g.black.bot || g.white.bot));
        if (withPerson.length >= MAX_PERSON_AI_GAMES) return ack({ ok: false, error: 'server_busy' });
      }
      if (people === 0) {
        const aiOnly = [...games.live.values()].filter((g) => games.isAiOnly(g));
        if (aiOnly.filter((g) => g.owner === u.id).length >= MAX_AI_ONLY_GAMES_PER_USER) {
          return ack({ ok: false, error: 'too_many_ai_games' });
        }
        if (aiOnly.length >= MAX_AI_ONLY_GAMES) return ack({ ok: false, error: 'server_busy' });
      }
      if (people === 1) starting.add(u.id);
      let g: LiveGame;
      try {
        const me = await users.byId(u.id);
        if (!me) return ack({ ok: false, error: 'no_such_user' });
        const side = (id: string | null) => (id === null ? me : botUsers.get(id)!);
        g = await games.create({
          black: side(r.black),
          white: side(r.white),
          settings: { size: r.size, komi: r.komi, handicap: r.handicap, ruleset: r.ruleset },
          clock: r.clock,
          rated: false,
          owner: people === 0 ? u.id : undefined,
        });
      } finally {
        if (people === 1) starting.delete(u.id);
      }
      if (people === 1) {
        clearWaiting(u.id);
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

    socket.on('gauge:watch', safe(async (gameId, ack) => {
      const g = games.live.get(String(gameId));
      if (!g) return ack({ ok: false, error: 'no_such_game' });
      // Seeing the evaluation while playing would be playing with an assistant.
      if (me && (me.id === g.black.id || me.id === g.white.id)) return ack({ ok: false, error: 'players_cannot_watch_gauge' });
      await socket.join(gaugeRoom(g.id));
      requestGauge(g);
      ack({ ok: true, gauge: gaugeState(g) });
    }));
    socket.on('gauge:unwatch', (gameId) => void socket.leave(gaugeRoom(String(gameId))));

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
      // Only people who have the game open (players and spectators) may write in its chat.
      if (!socket.rooms.has(gameRoom(String(gameId)))) return ack({ ok: false, error: 'not_in_game' });
      const msg = games.chat(String(gameId), u, String(text));
      if (!msg) return ack({ ok: false, error: 'invalid_chat' });
      io.to(gameRoom(String(gameId))).emit('game:chat', String(gameId), msg);
      ack({ ok: true });
      const g = games.live.get(String(gameId));
      if (g) void answerChat(g, u);
    }));

    socket.on('disconnect', () => {
      if (!me) limiter.forget(limitKey);
      if (me && lobby.disconnect(me.id)) {
        challenges.dropUser(me.id);
        broadcastLobby();
      }
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

  /** People whose game is being created right now (between the checks and the game existing). */
  const starting = new Set<string>();

  /** A player in a game should not have open seeks or challenges. */
  function clearWaiting(userId: string) {
    for (const [id, s] of lobby.seeks) if (s.creator.id === userId) lobby.seeks.delete(id);
    challenges.dropUser(userId);
  }

  /**
   * Starts a game between two people on conditions one of them (the offerer) set; the colour is from the offerer's side.
   * Returns an error code if either is already playing or starting a game.
   */
  async function startGame(offererId: string, otherId: string, s: SeekRequest): Promise<LiveGame | string> {
    if ([offererId, otherId].some((id) => starting.has(id) || userInGame(id))) return 'already_playing';
    // Hold both players until their game exists, so a second accept cannot start another game for either.
    const held = [offererId, otherId];
    held.forEach((id) => starting.add(id));
    let g: LiveGame;
    try {
      const [offerer, other] = await Promise.all([users.byId(offererId), users.byId(otherId)]);
      if (!offerer || !other) return 'no_such_user';
      const offererBlack = s.color === 'black' || (s.color === 'random' && Math.random() < 0.5);
      const settings: GameSettings = { size: s.size, komi: s.komi, handicap: s.handicap, ruleset: s.ruleset };
      g = await games.create({
        black: offererBlack ? offerer : other,
        white: offererBlack ? other : offerer,
        settings,
        clock: s.clock,
        rated: s.rated,
      });
    } finally {
      held.forEach((id) => starting.delete(id));
    }
    held.forEach(clearWaiting);
    io.to(userRoom(g.black.id)).to(userRoom(g.white.id)).emit('game:start', g.id);
    broadcastLobby();
    return g;
  }

  // Expired sessions would otherwise pile up in the table.
  const sweep = () =>
    void Promise.all([users.deleteExpiredSessions(), lobbyChat.deleteOld(), social.deleteOld()]).catch((e) => app.log.error(e));
  sweep();
  const sweepTimer = setInterval(sweep, SESSION_SWEEP_MS);
  sweepTimer.unref();

  function userInGame(userId: string): LiveGame | undefined {
    for (const g of games.live.values()) if (g.black.id === userId || g.white.id === userId) return g;
    return undefined;
  }

  app.addHook('onClose', async () => {
    clearInterval(sweepTimer);
    clearInterval(newsTimer);
    challenges.stop();
    gauge.stop();
    games.stop();
    io.close();
  });

  return { app, io, games, lobby, settings, challenges };
}
