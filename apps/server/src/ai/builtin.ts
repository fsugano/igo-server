import { BLACK, EMPTY, Game, PASS, Stone, WHITE } from '@igo/shared';
import type { Engine, EngineMove } from './engine.js';

/**
 * Built-in engine: flat Monte Carlo search with random playouts and AMAF (RAVE) statistics.
 * Needs no install. Strength is set by the number of playouts per move; it is a casual
 * opponent (roughly 20k-10k on 9x9, weaker on 19x19), not a strong one.
 */

interface Geometry {
  size: number;
  /** 4 neighbours per point, -1 off board. */
  nbr: Int32Array;
  /** 4 diagonals per point, -1 off board. */
  diag: Int32Array;
  edge: Uint8Array;
}

const geometries = new Map<number, Geometry>();
function geometry(size: number): Geometry {
  let g = geometries.get(size);
  if (g) return g;
  const n = size * size;
  const nbr = new Int32Array(n * 4).fill(-1);
  const diag = new Int32Array(n * 4).fill(-1);
  const edge = new Uint8Array(n);
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < size && y < size ? y * size + x : -1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = y * size + x;
      [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].forEach((q, i) => (nbr[p * 4 + i] = q));
      [at(x - 1, y - 1), at(x + 1, y - 1), at(x - 1, y + 1), at(x + 1, y + 1)].forEach((q, i) => (diag[p * 4 + i] = q));
      edge[p] = x === 0 || y === 0 || x === size - 1 || y === size - 1 ? 1 : 0;
    }
  }
  g = { size, nbr, diag, edge };
  geometries.set(size, g);
  return g;
}

/** Mutable board tuned for playouts. Same rules as the shared Board (simple ko, no suicide). */
export class FastBoard {
  readonly g: Geometry;
  readonly cells: Uint8Array;
  ko = -1;
  /** Unordered list of empty points; emptyPos[p] is p's index in it. */
  readonly empties: Int32Array;
  readonly emptyPos: Int32Array;
  emptyCount = 0;
  private mark: Uint32Array;
  private stamp = 0;
  private stack: Int32Array;

  constructor(size: number, src?: FastBoard) {
    this.g = geometry(size);
    const n = size * size;
    this.cells = new Uint8Array(n);
    this.empties = new Int32Array(n);
    this.emptyPos = new Int32Array(n);
    this.mark = new Uint32Array(n);
    this.stack = new Int32Array(n);
    if (src) this.copyFrom(src);
    else for (let p = 0; p < n; p++) this.addEmpty(p);
  }

  static fromGame(game: Game): FastBoard {
    const b = new FastBoard(game.settings.size);
    b.emptyCount = 0;
    game.board.cells.forEach((c, p) => {
      b.cells[p] = c;
      if (c === EMPTY) b.addEmpty(p);
    });
    b.ko = game.koPoint;
    return b;
  }

  copyFrom(o: FastBoard) {
    this.cells.set(o.cells);
    this.empties.set(o.empties);
    this.emptyPos.set(o.emptyPos);
    this.emptyCount = o.emptyCount;
    this.ko = o.ko;
  }

  private addEmpty(p: number) {
    this.emptyPos[p] = this.emptyCount;
    this.empties[this.emptyCount++] = p;
  }

  private removeEmpty(p: number) {
    const i = this.emptyPos[p];
    const last = this.empties[--this.emptyCount];
    this.empties[i] = last;
    this.emptyPos[last] = i;
  }

  /** True if the chain at p has at least one liberty. */
  private hasLiberty(p: number): boolean {
    const { cells } = this;
    const { nbr } = this.g;
    const color = cells[p];
    const s = ++this.stamp;
    let top = 0;
    this.stack[top++] = p;
    this.mark[p] = s;
    while (top) {
      const q = this.stack[--top];
      for (let i = q * 4, e = i + 4; i < e; i++) {
        const r = nbr[i];
        if (r < 0) continue;
        const c = cells[r];
        if (c === EMPTY) return true;
        if (c === color && this.mark[r] !== s) {
          this.mark[r] = s;
          this.stack[top++] = r;
        }
      }
    }
    return false;
  }

  /** Removes the chain at p; returns the number of stones removed. */
  private removeChain(p: number): number {
    const { cells } = this;
    const { nbr } = this.g;
    const color = cells[p];
    let top = 0;
    let n = 0;
    this.stack[top++] = p;
    cells[p] = EMPTY;
    while (top) {
      const q = this.stack[--top];
      this.addEmpty(q);
      n++;
      for (let i = q * 4, e = i + 4; i < e; i++) {
        const r = nbr[i];
        if (r >= 0 && cells[r] === color) {
          cells[r] = EMPTY;
          this.stack[top++] = r;
        }
      }
    }
    return n;
  }

  /** Plays a stone if legal. Returns false (board unchanged) for occupied, ko or suicide. */
  play(p: number, color: number): boolean {
    const { cells } = this;
    const { nbr } = this.g;
    if (cells[p] !== EMPTY || p === this.ko) return false;
    const enemy = 3 - color;
    cells[p] = color;
    let captured = 0;
    let capturedAt = -1;
    for (let i = p * 4, e = i + 4; i < e; i++) {
      const r = nbr[i];
      if (r >= 0 && cells[r] === enemy && !this.hasLiberty(r)) {
        captured += this.removeChain(r);
        capturedAt = r;
      }
    }
    if (captured === 0 && !this.hasLiberty(p)) {
      cells[p] = EMPTY;
      return false;
    }
    this.removeEmpty(p);
    this.ko = -1;
    if (captured === 1) {
      // Ko if the new stone is alone and its only liberty is the captured point.
      let alone = true;
      let libs = 0;
      for (let i = p * 4, e = i + 4; i < e; i++) {
        const r = nbr[i];
        if (r < 0) continue;
        if (cells[r] === color) alone = false;
        else if (cells[r] === EMPTY) libs++;
      }
      if (alone && libs === 1) this.ko = capturedAt;
    }
    return true;
  }

  /** An empty point whose neighbours are all `color` and that the opponent cannot easily break. */
  isEye(p: number, color: number): boolean {
    const { cells } = this;
    const { nbr, diag, edge } = this.g;
    for (let i = p * 4, e = i + 4; i < e; i++) {
      const r = nbr[i];
      if (r >= 0 && cells[r] !== color) return false;
    }
    let bad = 0;
    for (let i = p * 4, e = i + 4; i < e; i++) {
      const r = diag[i];
      if (r >= 0 && cells[r] === 3 - color) bad++;
    }
    return edge[p] ? bad === 0 : bad < 2;
  }

  /** Area score from black's view (stones + single-colour surrounded empty points), komi excluded. */
  areaScore(owner?: Float64Array): number {
    const { cells } = this;
    const { nbr } = this.g;
    let s = 0;
    for (let p = 0; p < cells.length; p++) {
      let c = cells[p];
      if (c === EMPTY) {
        let seen = 0;
        for (let i = p * 4, e = i + 4; i < e; i++) {
          const r = nbr[i];
          if (r >= 0) seen |= cells[r];
        }
        c = seen === BLACK || seen === WHITE ? seen : EMPTY;
      }
      const v = c === BLACK ? 1 : c === WHITE ? -1 : 0;
      s += v;
      if (owner) owner[p] += v;
    }
    return s;
  }
}

/** xorshift32 */
export function rng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

/**
 * Plays random non-eye-filling moves until both sides pass. Records in firstColor (where
 * firstStamp[p] === stamp) which colour played each point first. Returns black's area margin.
 */
function playout(
  b: FastBoard,
  toMove: number,
  rand: () => number,
  firstStamp: Uint32Array,
  firstColor: Uint8Array,
  stamp: number,
  owner?: Float64Array,
): number {
  const maxMoves = b.cells.length * 2;
  let color = toMove;
  let passes = 0;
  for (let m = 0; m < maxMoves && passes < 2; m++) {
    const k = b.emptyCount;
    let played = -1;
    let i = Math.floor(rand() * k);
    for (let tries = 0; tries < k; tries++, i = i + 1 === k ? 0 : i + 1) {
      const p = b.empties[i];
      if (b.isEye(p, color)) continue;
      if (b.play(p, color)) {
        played = p;
        break;
      }
    }
    if (played < 0) passes++;
    else {
      passes = 0;
      if (firstStamp[played] !== stamp) {
        firstStamp[played] = stamp;
        firstColor[played] = color;
      }
    }
    color = 3 - color;
  }
  return b.areaScore(owner);
}

export interface Analysis {
  /** Best move, or -1 when there is no sensible move left. */
  best: number;
  /** Win rate of the best move for the side to move. */
  winrate: number;
  /** Mean ownership per point over all playouts: +1 black, -1 white. */
  ownership: Float64Array;
  playouts: number;
}

export interface SearchOptions {
  playouts: number;
  /** Stop early after this many ms. */
  maxMs?: number;
  seed?: number;
  /** Yield to the event loop every this many ms so a long search does not stall the server. */
  sliceMs?: number;
}

const RAVE_K = 400;
const EXPLORE = 0.35;

const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));

export async function analyze(game: Game, color: Stone, opts: SearchOptions): Promise<Analysis> {
  const size = game.settings.size;
  const n = size * size;
  const komi = game.settings.komi;
  const root = FastBoard.fromGame(game);
  const rand = rng(opts.seed);
  const work = new FastBoard(size, root);
  const ownership = new Float64Array(n);

  // Root candidates: legal moves that do not fill our own eyes.
  const cands: number[] = [];
  for (let i = 0; i < root.emptyCount; i++) {
    const p = root.empties[i];
    if (root.isEye(p, color)) continue;
    work.copyFrom(root);
    if (work.play(p, color)) cands.push(p);
  }

  // Early in a game on a big board, prefer the 3rd/4th lines to the edge.
  const prior = new Float64Array(cands.length);
  if (size >= 13 && game.moves.length < size * 2) {
    cands.forEach((p, i) => {
      const x = p % size;
      const y = Math.floor(p / size);
      const line = Math.min(x, y, size - 1 - x, size - 1 - y);
      prior[i] = line < 2 ? -0.08 : line > 4 ? -0.02 : 0;
    });
  }

  const visits = new Float64Array(cands.length);
  const wins = new Float64Array(cands.length);
  const amafN = new Float64Array(cands.length);
  const amafW = new Float64Array(cands.length);
  const firstStamp = new Uint32Array(n);
  const firstColor = new Uint8Array(n);
  const start = Date.now();
  const slice = opts.sliceMs ?? 15;
  let sliceStart = start;
  let total = 0;

  for (; total < opts.playouts; total++) {
    if (cands.length === 0) {
      // Still estimate ownership (for scoring / pass decisions).
      work.copyFrom(root);
      playout(work, color, rand, firstStamp, firstColor, total + 1, ownership);
    } else {
      let bi = 0;
      let bv = -Infinity;
      const logN = Math.log(total + 1);
      for (let i = 0; i < cands.length; i++) {
        const v = visits[i];
        const mc = v ? wins[i] / v : 0.5;
        const am = amafN[i] ? amafW[i] / amafN[i] : 0.5;
        const beta = Math.sqrt(RAVE_K / (3 * v + RAVE_K));
        const q = (1 - beta) * mc + beta * am + prior[i] + EXPLORE * Math.sqrt(logN / (v + 1));
        if (q > bv) {
          bv = q;
          bi = i;
        }
      }
      const stamp = total + 1;
      work.copyFrom(root);
      work.play(cands[bi], color);
      firstStamp[cands[bi]] = stamp;
      firstColor[cands[bi]] = color;
      const margin = playout(work, 3 - color, rand, firstStamp, firstColor, stamp, ownership) - komi;
      const win = (margin > 0) === (color === BLACK) ? 1 : 0;
      visits[bi]++;
      wins[bi] += win;
      for (let i = 0; i < cands.length; i++) {
        const p = cands[i];
        if (firstStamp[p] === stamp && firstColor[p] === color) {
          amafN[i]++;
          amafW[i] += win;
        }
      }
    }
    if ((total & 15) === 15) {
      const now = Date.now();
      if (opts.maxMs !== undefined && now - start > opts.maxMs) {
        total++;
        break;
      }
      if (now - sliceStart > slice) {
        await yieldToLoop();
        sliceStart = Date.now();
      }
    }
  }
  if (total) for (let p = 0; p < n; p++) ownership[p] /= total;

  let bi = -1;
  for (let i = 0; i < cands.length; i++) if (bi < 0 || visits[i] > visits[bi]) bi = i;
  const best = bi < 0 ? -1 : cands[bi];
  const winrate = bi < 0 || !visits[bi] ? 0 : wins[bi] / visits[bi];
  return { best, winrate, ownership, playouts: total };
}

/** Black's margin estimated from mean ownership (area counting, komi included). */
export function estimateMargin(ownership: Float64Array, komi: number): number {
  let s = 0;
  for (const v of ownership) s += v > 0.3 ? 1 : v < -0.3 ? -1 : 0;
  return s - komi;
}

/** Stones whose point is owned by the opponent in most playouts. */
export function deadFromOwnership(game: Game, ownership: Float64Array): number[] {
  const dead: number[] = [];
  game.board.cells.forEach((c, p) => {
    if (c === BLACK && ownership[p] < -0.4) dead.push(p);
    if (c === WHITE && ownership[p] > 0.4) dead.push(p);
  });
  return dead;
}

export interface BuiltinLevel {
  id: string;
  username: string;
  label: string;
  rank: string;
  playouts: number;
  maxMs: number;
  /** Resign when the best win rate drops below this (0 = never). */
  resignBelow: number;
}

export const BUILTIN_LEVELS: BuiltinLevel[] = [
  { id: 'builtin-1', username: 'AI-Lv1', label: '入門 (Lv1)', rank: '25k', playouts: 150, maxMs: 1000, resignBelow: 0 },
  { id: 'builtin-2', username: 'AI-Lv2', label: '初級 (Lv2)', rank: '20k', playouts: 1500, maxMs: 2000, resignBelow: 0.04 },
  { id: 'builtin-3', username: 'AI-Lv3', label: '中級 (Lv3)', rank: '15k', playouts: 8000, maxMs: 4000, resignBelow: 0.05 },
];

export class BuiltinEngine implements Engine {
  readonly id: string;
  readonly username: string;
  readonly label: string;
  readonly rank: string;

  constructor(
    private level: BuiltinLevel,
    private seed?: number,
  ) {
    this.id = level.id;
    this.username = level.username;
    this.label = level.label;
    this.rank = level.rank;
  }

  async genMove(game: Game, color: Stone): Promise<EngineMove> {
    const size = game.settings.size;
    // Guard against endless games (e.g. repeating triple ko).
    if (game.moves.length > size * size * 2) return { type: 'pass' };
    const a = await analyze(game, color, { playouts: this.level.playouts, maxMs: this.level.maxMs, seed: this.seed });
    if (a.best < 0) return { type: 'pass' };
    const last = game.moves[game.moves.length - 1];
    if (last?.p === PASS) {
      // Opponent passed: end the game if we are ahead on the current estimate.
      const margin = estimateMargin(a.ownership, game.settings.komi);
      if ((color === BLACK ? margin : -margin) > 0) return { type: 'pass' };
    }
    if (this.level.resignBelow && a.winrate < this.level.resignBelow && game.moves.length > (size * size) / 3) {
      return { type: 'resign' };
    }
    return { type: 'play', p: a.best };
  }

  async deadStones(game: Game): Promise<number[]> {
    const a = await analyze(game, game.toMove, { playouts: 600, maxMs: 2000, seed: this.seed });
    return deadFromOwnership(game, a.ownership);
  }
}
