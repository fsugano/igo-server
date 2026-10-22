import {
  BLACK,
  ChatMessage,
  ClockSettings,
  Game,
  GameSettings,
  GameSummary,
  GameView,
  Move,
  PASS,
  PlayerClock,
  PublicUser,
  Stone,
  WHITE,
  chargeMove,
  describeClock,
  initialClock,
  rankLabel,
  timeUntilFlag,
  toSgf,
  updateRatings,
} from '@igo/shared';
import type { Db } from './db.js';
import { UserRow, toPublicUser } from './users.js';

export interface LiveGame {
  id: string;
  black: PublicUser;
  white: PublicUser;
  rated: boolean;
  clockSettings: ClockSettings;
  clocks: { black: PlayerClock; white: PlayerClock };
  turnStartedAt: number | null;
  game: Game;
  chat: ChatMessage[];
  startedAt: number;
  ratingChange: { black: number; white: number } | null;
  timer: NodeJS.Timeout | null;
  /** Serialises operations on this game. */
  queue: Promise<unknown>;
}

export interface GameEvents {
  update(g: LiveGame): void;
  finished(g: LiveGame): void;
}

export type Result = { ok: true } | { ok: false; error: string };

const MAX_CHAT = 200;
const colorKey = (c: Stone) => (c === BLACK ? 'black' : 'white');

/** Owns all in-progress games: rules, clocks, persistence and rating updates. */
export class GameService {
  readonly live = new Map<string, LiveGame>();

  constructor(
    private db: Db,
    private events: GameEvents,
    private now: () => number = Date.now,
  ) {}

  /** Restores active games after a restart. The player to move gets a fresh turn start. */
  async loadActive(): Promise<number> {
    const r = await this.db.query(
      `SELECT g.*, row_to_json(b) AS b, row_to_json(w) AS w FROM games g
       JOIN users b ON b.id = g.black_id JOIN users w ON w.id = g.white_id
       WHERE g.status = 'active'`,
    );
    for (const row of r.rows) {
      const game = Game.fromMoves(row.settings, row.moves);
      const g = this.makeLive(String(row.id), toPublicUser(row.b), toPublicUser(row.w), row.rated, row.clock_settings, game);
      g.clocks = row.clocks;
      g.startedAt = new Date(row.started_at).getTime();
      g.turnStartedAt = game.phase === 'playing' ? this.now() : null;
      this.live.set(g.id, g);
      this.schedule(g);
    }
    return r.rows.length;
  }

  async create(opts: {
    black: UserRow;
    white: UserRow;
    settings: GameSettings;
    clock: ClockSettings;
    rated: boolean;
  }): Promise<LiveGame> {
    const { black, white, settings, clock, rated } = opts;
    const clocks = { black: initialClock(clock), white: initialClock(clock) };
    const r = await this.db.query(
      `INSERT INTO games (black_id, white_id, settings, clock_settings, rated, clocks, black_rating, white_rating)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, started_at`,
      [black.id, white.id, settings, clock, rated, clocks, black.rating, white.rating],
    );
    const g = this.makeLive(String(r.rows[0].id), toPublicUser(black), toPublicUser(white), rated, clock, new Game(settings));
    g.clocks = clocks;
    g.startedAt = new Date(r.rows[0].started_at).getTime();
    g.turnStartedAt = this.now();
    this.live.set(g.id, g);
    this.schedule(g);
    return g;
  }

  colorOf(g: LiveGame, userId: string | undefined): Stone | null {
    if (!userId) return null;
    if (g.black.id === userId) return BLACK;
    if (g.white.id === userId) return WHITE;
    return null;
  }

  view(g: LiveGame, spectators = 0): GameView {
    return {
      id: g.id,
      black: g.black,
      white: g.white,
      rated: g.rated,
      clock: g.clockSettings,
      clocks: g.clocks,
      turnStartedAt: g.turnStartedAt,
      serverNow: this.now(),
      state: g.game.snapshot(),
      spectators,
      chat: g.chat,
      ratingChange: g.ratingChange,
    };
  }

  summary(g: LiveGame): GameSummary {
    return {
      id: g.id,
      black: g.black,
      white: g.white,
      size: g.game.settings.size,
      moveCount: g.game.moves.length,
      rated: g.rated,
      status: g.game.phase === 'finished' ? 'finished' : 'active',
      result: g.game.result,
      startedAt: g.startedAt,
    };
  }

  move(id: string, userId: string, point: number, moveNumber: number): Promise<Result> {
    return this.act(id, userId, true, (g, color) => {
      if (moveNumber !== g.game.moves.length) return 'stale_move';
      return this.withClock(g, color, () => g.game.play(color, point));
    });
  }

  pass(id: string, userId: string, moveNumber: number): Promise<Result> {
    return this.act(id, userId, true, (g, color) => {
      if (moveNumber !== g.game.moves.length) return 'stale_move';
      return this.withClock(g, color, () => g.game.pass(color));
    });
  }

  resign(id: string, userId: string): Promise<Result> {
    return this.act(id, userId, true, (g, color) => g.game.resign(color));
  }

  toggleDead(id: string, userId: string, point: number): Promise<Result> {
    return this.act(id, userId, true, (g) => g.game.toggleDead(point));
  }

  acceptScore(id: string, userId: string): Promise<Result> {
    return this.act(id, userId, true, (g, color) => g.game.acceptScore(color));
  }

  resume(id: string, userId: string): Promise<Result> {
    return this.act(id, userId, true, (g) => {
      const err = g.game.resume();
      if (!err) g.turnStartedAt = this.now();
      return err;
    });
  }

  chat(id: string, user: PublicUser, text: string): ChatMessage | null {
    const g = this.live.get(id);
    const t = text.trim().slice(0, 300);
    if (!g || !t) return null;
    const msg = { user: user.username, text: t, at: this.now() };
    g.chat.push(msg);
    if (g.chat.length > MAX_CHAT) g.chat.shift();
    return msg;
  }

  stop() {
    for (const g of this.live.values()) if (g.timer) clearTimeout(g.timer);
  }

  /** Runs fn under the game's lock, then persists and broadcasts if it succeeded. */
  private act(
    id: string,
    userId: string,
    playerOnly: boolean,
    fn: (g: LiveGame, color: Stone) => string | null,
  ): Promise<Result> {
    const g = this.live.get(id);
    if (!g) return Promise.resolve({ ok: false, error: 'no_such_game' });
    const run = async (): Promise<Result> => {
      const color = this.colorOf(g, userId);
      if (playerOnly && !color) return { ok: false, error: 'not_a_player' };
      if (g.game.phase === 'finished') return { ok: false, error: 'game_over' };
      const err = fn(g, color!);
      if (err) return { ok: false, error: err };
      await this.commit(g);
      return { ok: true };
    };
    const p = g.queue.then(run, run);
    g.queue = p.catch(() => {});
    return p;
  }

  /** Charges the mover's clock around a move; flags them instead if their time ran out. */
  private withClock(g: LiveGame, color: Stone, apply: () => string | null): string | null {
    const key = colorKey(color);
    const elapsed = g.turnStartedAt === null ? 0 : this.now() - g.turnStartedAt;
    const charged = chargeMove(g.clockSettings, g.clocks[key], elapsed);
    if (charged.timedOut) {
      g.clocks[key] = charged.clock;
      g.game.timeout(color);
      return null;
    }
    const err = apply();
    if (err) return err;
    g.clocks[key] = charged.clock;
    g.turnStartedAt = g.game.phase === 'playing' ? this.now() : null;
    return null;
  }

  private async commit(g: LiveGame) {
    if (g.game.phase === 'finished') {
      g.turnStartedAt = null;
      await this.finalize(g);
    } else {
      await this.db.query('UPDATE games SET moves = $2, clocks = $3 WHERE id = $1', [
        g.id,
        JSON.stringify(g.game.moves),
        g.clocks,
      ]);
    }
    this.schedule(g);
    this.events.update(g);
    if (g.game.phase === 'finished') {
      this.live.delete(g.id);
      this.events.finished(g);
    }
  }

  private async finalize(g: LiveGame) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const users = await client.query<UserRow>('SELECT * FROM users WHERE id = ANY($1) FOR UPDATE', [[g.black.id, g.white.id]]);
      const b = users.rows.find((u) => String(u.id) === g.black.id)!;
      const w = users.rows.find((u) => String(u.id) === g.white.id)!;
      // Games with fewer than two moves each are not rated (aborted / disconnected starts).
      const winner = g.game.winner();
      const counts = g.rated && g.game.moves.filter((m) => m.p !== PASS).length >= 4;
      if (counts) {
        const s = winner === BLACK ? 1 : winner === WHITE ? 0 : 0.5;
        const nr = updateRatings(
          { rating: b.rating, games: b.games_played },
          { rating: w.rating, games: w.games_played },
          s,
          g.game.settings.handicap,
        );
        g.ratingChange = { black: Math.round(nr.black - b.rating), white: Math.round(nr.white - w.rating) };
        await client.query('UPDATE users SET rating = $2, games_played = games_played + 1 WHERE id = $1', [b.id, nr.black]);
        await client.query('UPDATE users SET rating = $2, games_played = games_played + 1 WHERE id = $1', [w.id, nr.white]);
      }
      const sgf = this.sgf(g, b.rating, w.rating);
      await client.query(
        `UPDATE games SET status = 'finished', moves = $2, clocks = $3, result = $4, rating_change = $5, sgf = $6, ended_at = now()
         WHERE id = $1`,
        [g.id, JSON.stringify(g.game.moves), g.clocks, g.game.result, g.ratingChange, sgf],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  sgf(g: LiveGame, blackRating = g.black.rating, whiteRating = g.white.rating): string {
    return buildSgf({
      settings: g.game.settings,
      moves: g.game.moves,
      clock: g.clockSettings,
      black: g.black.username,
      white: g.white.username,
      blackRating,
      whiteRating,
      result: g.game.result,
      startedAt: g.startedAt,
    });
  }

  /** Arms a timer that flags the player to move when their time runs out. */
  private schedule(g: LiveGame) {
    if (g.timer) clearTimeout(g.timer);
    g.timer = null;
    if (g.game.phase !== 'playing' || g.turnStartedAt === null) return;
    const color = g.game.toMove;
    const left = timeUntilFlag(g.clockSettings, g.clocks[colorKey(color)]) - (this.now() - g.turnStartedAt);
    const moveCount = g.game.moves.length;
    g.timer = setTimeout(() => {
      void this.act(g.id, '', false, (gg) => {
        if (gg.game.moves.length !== moveCount || gg.game.phase !== 'playing') return 'stale_timer';
        return this.withClock(gg, color, () => 'still_thinking');
      }).then((r) => {
        // Timer fired a little early: re-arm.
        if (!r.ok && r.error === 'still_thinking') this.schedule(g);
      });
    }, Math.max(0, left) + 50);
  }

  private makeLive(
    id: string,
    black: PublicUser,
    white: PublicUser,
    rated: boolean,
    clockSettings: ClockSettings,
    game: Game,
  ): LiveGame {
    return {
      id,
      black,
      white,
      rated,
      clockSettings,
      clocks: { black: initialClock(clockSettings), white: initialClock(clockSettings) },
      turnStartedAt: null,
      game,
      chat: [],
      startedAt: this.now(),
      ratingChange: null,
      timer: null,
      queue: Promise.resolve(),
    };
  }
}

export function buildSgf(o: {
  settings: GameSettings;
  moves: Move[];
  clock: ClockSettings;
  black: string;
  white: string;
  blackRating: number;
  whiteRating: number;
  result: string | null;
  startedAt: number;
}): string {
  return toSgf(o.settings, o.moves, {
    blackName: o.black,
    whiteName: o.white,
    blackRank: rankLabel(o.blackRating),
    whiteRank: rankLabel(o.whiteRating),
    result: o.result,
    date: new Date(o.startedAt).toISOString().slice(0, 10),
    timeLimitSec: Math.round(o.clock.mainTime / 1000),
    overtime: describeClock(o.clock),
    place: 'igo',
  });
}
