export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export type Stone = typeof BLACK | typeof WHITE;
export type Cell = typeof EMPTY | Stone;

export const opponent = (c: Stone): Stone => (c === BLACK ? WHITE : BLACK);

export type MoveError = 'occupied' | 'suicide' | 'ko' | 'out_of_bounds';

export interface PlayResult {
  board: Board;
  captured: number[];
  /** Point that the opponent may not retake on the next move (simple ko), or -1. */
  koPoint: number;
}

/** Immutable Go board. Points are indexed as y * size + x. */
export class Board {
  readonly size: number;
  readonly cells: Uint8Array;

  constructor(size: number, cells?: Uint8Array) {
    this.size = size;
    this.cells = cells ?? new Uint8Array(size * size);
  }

  idx(x: number, y: number): number {
    return y * this.size + x;
  }

  xy(p: number): [number, number] {
    return [p % this.size, Math.floor(p / this.size)];
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  get(p: number): Cell {
    return this.cells[p] as Cell;
  }

  neighbors(p: number): number[] {
    const s = this.size;
    const x = p % s;
    const out: number[] = [];
    if (x > 0) out.push(p - 1);
    if (x < s - 1) out.push(p + 1);
    if (p >= s) out.push(p - s);
    if (p < s * (s - 1)) out.push(p + s);
    return out;
  }

  /** Returns the chain containing p and its liberties. */
  chain(p: number): { stones: number[]; liberties: Set<number> } {
    const color = this.cells[p];
    const stones: number[] = [];
    const liberties = new Set<number>();
    if (color === EMPTY) return { stones, liberties };
    const seen = new Set<number>([p]);
    const stack = [p];
    while (stack.length) {
      const q = stack.pop()!;
      stones.push(q);
      for (const n of this.neighbors(q)) {
        const c = this.cells[n];
        if (c === EMPTY) liberties.add(n);
        else if (c === color && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    return { stones, liberties };
  }

  withStones(points: number[], value: Cell): Board {
    const cells = this.cells.slice();
    for (const p of points) cells[p] = value;
    return new Board(this.size, cells);
  }

  /** Attempts to play a stone. koPoint is the point currently forbidden by simple ko. */
  play(p: number, color: Stone, koPoint = -1): PlayResult | MoveError {
    if (p < 0 || p >= this.cells.length) return 'out_of_bounds';
    if (this.cells[p] !== EMPTY) return 'occupied';
    if (p === koPoint) return 'ko';

    const cells = this.cells.slice();
    cells[p] = color;
    const next = new Board(this.size, cells);
    const enemy = opponent(color);
    const captured: number[] = [];

    for (const n of next.neighbors(p)) {
      if (cells[n] !== enemy || captured.includes(n)) continue;
      const ch = next.chain(n);
      if (ch.liberties.size === 0) {
        for (const s of ch.stones) {
          cells[s] = EMPTY;
          captured.push(s);
        }
      }
    }

    const own = next.chain(p);
    if (own.liberties.size === 0) return 'suicide';

    // Simple ko: a single stone captured exactly one stone and is now in atari.
    let newKo = -1;
    if (captured.length === 1 && own.stones.length === 1 && own.liberties.size === 1) {
      newKo = captured[0];
    }
    return { board: next, captured, koPoint: newKo };
  }
}

/** Standard handicap star points (Japanese placement order). */
export function handicapPoints(size: number, handicap: number): [number, number][] {
  if (handicap < 2) return [];
  const edge = size >= 13 ? 3 : 2;
  const lo = edge;
  const hi = size - 1 - edge;
  const mid = (size - 1) / 2;
  const hasMid = size % 2 === 1 && size >= 9;
  const corners: [number, number][] = [
    [hi, lo],
    [lo, hi],
    [hi, hi],
    [lo, lo],
  ];
  const sides: [number, number][] = [
    [lo, mid],
    [hi, mid],
    [mid, lo],
    [mid, hi],
  ];
  const max = hasMid ? 9 : 4;
  const n = Math.min(handicap, max);
  if (n <= 4) return corners.slice(0, n);
  const pts: [number, number][] = [...corners];
  if (n === 5) pts.push([mid, mid]);
  if (n >= 6) pts.push(sides[0], sides[1]);
  if (n === 7) pts.push([mid, mid]);
  if (n >= 8) pts.push(sides[2], sides[3]);
  if (n === 9) pts.push([mid, mid]);
  return pts;
}
