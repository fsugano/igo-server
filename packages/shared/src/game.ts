import { BLACK, Board, EMPTY, MoveError, Stone, WHITE, handicapPoints, opponent } from './board.js';
import { Ruleset, Score, score } from './scoring.js';

export interface GameSettings {
  size: number;
  komi: number;
  handicap: number;
  ruleset: Ruleset;
}

/** A move. p = -1 means pass. */
export interface Move {
  c: Stone;
  p: number;
}

export type Phase = 'playing' | 'scoring' | 'finished';

export type GameError = MoveError | 'not_your_turn' | 'wrong_phase' | 'not_a_stone';

export interface GameSnapshot {
  settings: GameSettings;
  cells: number[];
  toMove: Stone;
  koPoint: number;
  captures: { black: number; white: number };
  moves: Move[];
  phase: Phase;
  dead: number[];
  accepted: Stone[];
  result: string | null;
  score: Score | null;
}

export const PASS = -1;

/** Full game state machine: play, pass, two-pass scoring phase, resign, timeout. */
export class Game {
  readonly settings: GameSettings;
  board: Board;
  toMove: Stone;
  koPoint = -1;
  capturesByBlack = 0;
  capturesByWhite = 0;
  moves: Move[] = [];
  phase: Phase = 'playing';
  dead = new Set<number>();
  accepted = new Set<Stone>();
  result: string | null = null;
  private consecutivePasses = 0;

  constructor(settings: GameSettings) {
    this.settings = settings;
    let board = new Board(settings.size);
    const hc = handicapPoints(settings.size, settings.handicap);
    if (hc.length) board = board.withStones(hc.map(([x, y]) => board.idx(x, y)), BLACK);
    this.board = board;
    this.toMove = hc.length ? WHITE : BLACK;
  }

  static fromMoves(settings: GameSettings, moves: Move[]): Game {
    const g = new Game(settings);
    for (const m of moves) {
      const err = m.p === PASS ? g.pass(m.c) : g.play(m.c, m.p);
      if (err) throw new Error(`invalid move record at ${g.moves.length}: ${err}`);
    }
    return g;
  }

  play(color: Stone, p: number): GameError | null {
    if (this.phase !== 'playing') return 'wrong_phase';
    if (color !== this.toMove) return 'not_your_turn';
    const r = this.board.play(p, color, this.koPoint);
    if (typeof r === 'string') return r;
    this.board = r.board;
    this.koPoint = r.koPoint;
    if (color === BLACK) this.capturesByBlack += r.captured.length;
    else this.capturesByWhite += r.captured.length;
    this.moves.push({ c: color, p });
    this.toMove = opponent(color);
    this.consecutivePasses = 0;
    return null;
  }

  pass(color: Stone): GameError | null {
    if (this.phase !== 'playing') return 'wrong_phase';
    if (color !== this.toMove) return 'not_your_turn';
    this.moves.push({ c: color, p: PASS });
    this.koPoint = -1;
    this.toMove = opponent(color);
    this.consecutivePasses++;
    if (this.consecutivePasses >= 2) {
      this.phase = 'scoring';
      this.dead.clear();
      this.accepted.clear();
    }
    return null;
  }

  resign(color: Stone): GameError | null {
    if (this.phase === 'finished') return 'wrong_phase';
    this.finish(`${color === BLACK ? 'W' : 'B'}+R`);
    return null;
  }

  timeout(color: Stone): GameError | null {
    if (this.phase === 'finished') return 'wrong_phase';
    this.finish(`${color === BLACK ? 'W' : 'B'}+T`);
    return null;
  }

  /** In the scoring phase, toggles the whole chain at p between alive and dead. */
  toggleDead(p: number): GameError | null {
    if (this.phase !== 'scoring') return 'wrong_phase';
    if (p < 0 || p >= this.board.cells.length || this.board.get(p) === EMPTY) return 'not_a_stone';
    const { stones } = this.board.chain(p);
    const makeDead = !this.dead.has(p);
    for (const s of stones) {
      if (makeDead) this.dead.add(s);
      else this.dead.delete(s);
    }
    this.accepted.clear();
    return null;
  }

  acceptScore(color: Stone): GameError | null {
    if (this.phase !== 'scoring') return 'wrong_phase';
    this.accepted.add(color);
    if (this.accepted.size === 2) {
      const s = this.score();
      const m = s.margin;
      this.finish(m === 0 ? 'Draw' : `${m > 0 ? 'B' : 'W'}+${Math.abs(m)}`);
    }
    return null;
  }

  /** Leaves the scoring phase and continues play (dispute). The player to move is unchanged. */
  resume(): GameError | null {
    if (this.phase !== 'scoring') return 'wrong_phase';
    this.phase = 'playing';
    this.consecutivePasses = 0;
    this.dead.clear();
    this.accepted.clear();
    return null;
  }

  score(): Score {
    return score({
      board: this.board,
      dead: this.dead,
      capturesByBlack: this.capturesByBlack,
      capturesByWhite: this.capturesByWhite,
      komi: this.settings.komi,
      ruleset: this.settings.ruleset,
    });
  }

  /** Winner colour from the result string, or null for draw / unfinished. */
  winner(): Stone | null {
    if (!this.result) return null;
    if (this.result.startsWith('B+')) return BLACK;
    if (this.result.startsWith('W+')) return WHITE;
    return null;
  }

  snapshot(): GameSnapshot {
    return {
      settings: this.settings,
      cells: Array.from(this.board.cells),
      toMove: this.toMove,
      koPoint: this.koPoint,
      captures: { black: this.capturesByBlack, white: this.capturesByWhite },
      moves: this.moves.slice(),
      phase: this.phase,
      dead: [...this.dead],
      accepted: [...this.accepted],
      result: this.result,
      score: this.hasCountedScore() ? this.score() : null,
    };
  }

  private hasCountedScore(): boolean {
    if (this.phase === 'scoring') return true;
    return this.phase === 'finished' && !!this.result && !/\+[RT]$/.test(this.result);
  }

  private finish(result: string) {
    this.phase = 'finished';
    this.result = result;
  }
}
