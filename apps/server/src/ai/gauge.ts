import { BLACK, Game, GaugeEval } from '@igo/shared';
import { analyze, estimateMargin } from './builtin.js';

/** Estimates who is ahead. Separate from Engine: it judges positions, it does not play. */
export interface Evaluator {
  /** Shown to spectators, e.g. "builtin" for the quick estimate. */
  readonly id: string;
  /** Black's chance of winning in this position, 0..1. The game is a private copy. */
  evaluate(game: Game): Promise<number>;
}

/** The built-in Monte Carlo search. Rough, but needs no install. */
export class BuiltinEvaluator implements Evaluator {
  readonly id = 'builtin';

  constructor(private opts: { playouts: number; maxMs: number } = { playouts: 1000, maxMs: 800 }) {}

  async evaluate(game: Game): Promise<number> {
    const a = await analyze(game, game.toMove, this.opts);
    // The mean over all playouts moves much less from one position to the next than the best move's
    // win rate, so the gauge does not jump about on noise.
    if (a.best >= 0 && a.playouts > 0) return game.toMove === BLACK ? a.meanWinrate : 1 - a.meanWinrate;
    // No sensible move left: judge from the expected territory instead.
    const margin = estimateMargin(a.ownership, game.settings.komi);
    return 1 / (1 + Math.exp(-margin / 4));
  }
}

const MAX_PENDING_PER_GAME = 3;
const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5);

/**
 * Evaluates positions of watched games one at a time and remembers the results.
 * Callers decide what each viewer may see (see visible()).
 */
export class GaugeService {
  private evals = new Map<string, Map<number, GaugeEval>>();
  private queue: { gameId: string; moveNumber: number; game: Game }[] = [];
  /** Games still wanted: a result that arrives after forget() is dropped. */
  private active = new Set<string>();
  private running = false;
  private stopped = false;

  constructor(
    readonly evaluator: Evaluator,
    private onEval: (gameId: string) => void,
    private onError: (e: unknown) => void = () => {},
  ) {}

  /** Asks for the position after `moveNumber` moves to be evaluated, unless it already is or is queued. */
  request(gameId: string, moveNumber: number, game: Game) {
    if (this.stopped || this.evals.get(gameId)?.has(moveNumber)) return;
    if (this.queue.some((j) => j.gameId === gameId && j.moveNumber === moveNumber)) return;
    this.active.add(gameId);
    // A fast game can outrun the evaluator: keep only the newest few positions per game.
    const mine = this.queue.filter((j) => j.gameId === gameId);
    if (mine.length >= MAX_PENDING_PER_GAME) this.queue.splice(this.queue.indexOf(mine[0]), 1);
    this.queue.push({ gameId, moveNumber, game });
    void this.pump();
  }

  /** Evaluations of positions at least `delay` moves before the current one, oldest first. */
  visible(gameId: string, movesPlayed: number, delay: number): GaugeEval[] {
    const m = this.evals.get(gameId);
    if (!m) return [];
    return [...m.values()].filter((e) => e.moveNumber <= movesPlayed - delay).sort((a, b) => a.moveNumber - b.moveNumber);
  }

  forget(gameId: string) {
    this.active.delete(gameId);
    this.evals.delete(gameId);
    this.queue = this.queue.filter((j) => j.gameId !== gameId);
  }

  stop() {
    this.stopped = true;
    this.queue = [];
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.stopped) {
        const job = this.queue.shift()!;
        let w: number;
        try {
          w = await this.evaluator.evaluate(job.game);
        } catch (e) {
          this.onError(e);
          continue;
        }
        if (this.stopped) break;
        // The game may have ended (and been forgotten) while we were thinking.
        if (!this.active.has(job.gameId)) continue;
        let m = this.evals.get(job.gameId);
        if (!m) this.evals.set(job.gameId, (m = new Map()));
        m.set(job.moveNumber, { moveNumber: job.moveNumber, winrateBlack: clamp01(w) });
        this.onEval(job.gameId);
      }
    } finally {
      this.running = false;
    }
  }
}
