import { describe, expect, it } from 'vitest';
import {
  BLACK, Board, Game, PASS, WHITE, chargeMove, displayClock, handicapPoints, initialClock,
  parseSgf, rankLabel, ratingForRank, timeUntilFlag, toSgf, updateRatings,
} from '../src/index.js';
import type { ClockSettings, GameSettings } from '../src/index.js';

const S9: GameSettings = { size: 9, komi: 6.5, handicap: 0, ruleset: 'japanese' };

/** Builds a board from rows of '.', 'X' (black), 'O' (white). */
function boardFrom(rows: string[]): Board {
  const size = rows.length;
  const b = new Board(size);
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === 'X') b.cells[y * size + x] = BLACK;
    if (ch === 'O') b.cells[y * size + x] = WHITE;
  }));
  return b;
}

describe('board', () => {
  it('captures a single stone', () => {
    const b = boardFrom(['.X...', 'XO...', '.X...', '.....', '.....']);
    const r = b.play(b.idx(2, 1), BLACK);
    if (typeof r === 'string') throw new Error(r);
    expect(r.captured).toEqual([b.idx(1, 1)]);
    expect(r.board.get(b.idx(1, 1))).toBe(0);
  });

  it('captures a group in the corner', () => {
    const b = boardFrom(['OOX..', 'XXX..', '.....', '.....', '.....']);
    const r = b.play(b.idx(0, 0), BLACK);
    expect(r).toBe('occupied');
    const b2 = boardFrom(['OO.X.', 'XXXX.', '.....', '.....', '.....']);
    const r2 = b2.play(b2.idx(2, 0), BLACK);
    if (typeof r2 === 'string') throw new Error(r2);
    expect(r2.captured.sort()).toEqual([0, 1]);
  });

  it('forbids suicide', () => {
    const b = boardFrom(['.X...', 'X....', '.....', '.....', '.....']);
    expect(b.play(0, WHITE)).toBe('suicide');
  });

  it('allows a move that would be suicide but captures', () => {
    const b = boardFrom(['.XO..', 'XO...', 'O....', '.....', '.....']);
    const r = b.play(0, WHITE);
    if (typeof r === 'string') throw new Error(r);
    expect(r.captured.sort()).toEqual([1, 5]);
  });

  it('places handicap stones', () => {
    expect(handicapPoints(19, 2)).toEqual([[15, 3], [3, 15]]);
    expect(handicapPoints(19, 9)).toHaveLength(9);
    expect(handicapPoints(19, 5)).toContainEqual([9, 9]);
  });
});

describe('game', () => {
  it('enforces simple ko and allows retake after a ko threat', () => {
    // Classic ko shape in the middle of a 9x9 board.
    const g = new Game(S9);
    const p = (x: number, y: number) => y * 9 + x;
    const seq: [number, number, number][] = [
      [BLACK, 3, 4], [WHITE, 4, 4],
      [BLACK, 4, 3], [WHITE, 5, 3],
      [BLACK, 4, 5], [WHITE, 5, 5],
      [BLACK, 0, 0], [WHITE, 6, 4],
      [BLACK, 5, 4], // captures white at (4,4)
    ];
    for (const [c, x, y] of seq) expect(g.play(c as 1 | 2, p(x, y))).toBeNull();
    expect(g.capturesByBlack).toBe(1);
    expect(g.play(WHITE, p(4, 4))).toBe('ko');
    expect(g.play(WHITE, p(8, 8))).toBeNull(); // ko threat
    expect(g.play(BLACK, p(8, 7))).toBeNull(); // answer
    expect(g.play(WHITE, p(4, 4))).toBeNull(); // retake now legal
    expect(g.capturesByWhite).toBe(1);
  });

  it('rejects moves out of turn', () => {
    const g = new Game(S9);
    expect(g.play(WHITE, 0)).toBe('not_your_turn');
  });

  it('white moves first in handicap games', () => {
    const g = new Game({ ...S9, size: 19, handicap: 4 });
    expect(g.toMove).toBe(WHITE);
    expect(g.board.cells.filter((c) => c === BLACK)).toHaveLength(4);
  });

  it('goes to scoring after two passes and finishes on mutual agreement', () => {
    const g = new Game({ ...S9, size: 5, komi: 0.5 });
    // Black walls off the left, white the right.
    const moves = [[1, 0], [3, 0], [1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3], [1, 4], [3, 4]];
    moves.forEach(([x, y], i) => expect(g.play(i % 2 ? WHITE : BLACK, y * 5 + x)).toBeNull());
    // White invades black's area with a stone that will be marked dead.
    expect(g.play(BLACK, 2 * 5 + 2)).toBeNull();
    expect(g.play(WHITE, 0)).toBeNull();
    expect(g.pass(BLACK)).toBeNull();
    expect(g.pass(WHITE)).toBeNull();
    expect(g.phase).toBe('scoring');
    expect(g.toggleDead(0)).toBeNull();
    expect(g.acceptScore(BLACK)).toBeNull();
    expect(g.phase).toBe('scoring');
    expect(g.acceptScore(WHITE)).toBeNull();
    expect(g.phase).toBe('finished');
    const s = g.score();
    // Black: territory col 0 (5) + 1 prisoner. White: col 4 (5) + 0.5 komi.
    expect(s.blackTerritory).toBe(5);
    expect(s.whiteTerritory).toBe(5);
    expect(g.result).toBe('B+0.5');
  });

  it('toggling dead stones resets acceptance; resume returns to play', () => {
    const g = new Game(S9);
    g.play(BLACK, 40); g.pass(WHITE); g.pass(BLACK);
    expect(g.phase).toBe('scoring');
    g.acceptScore(BLACK);
    g.toggleDead(40);
    expect(g.accepted.size).toBe(0);
    expect(g.resume()).toBeNull();
    expect(g.phase).toBe('playing');
    expect(g.toMove).toBe(WHITE);
  });

  it('resign and timeout set results', () => {
    const g = new Game(S9);
    g.resign(BLACK);
    expect(g.result).toBe('W+R');
    const g2 = new Game(S9);
    g2.timeout(WHITE);
    expect(g2.result).toBe('B+T');
    expect(g2.snapshot().score).toBeNull();
  });

  it('replays from a move list', () => {
    const g = new Game(S9);
    g.play(BLACK, 10); g.play(WHITE, 20); g.pass(BLACK);
    const r = Game.fromMoves(S9, g.moves);
    expect(Array.from(r.board.cells)).toEqual(Array.from(g.board.cells));
    expect(r.toMove).toBe(WHITE);
  });

  it('chinese area scoring counts stones', () => {
    const g = new Game({ size: 5, komi: 0, handicap: 0, ruleset: 'chinese' });
    for (let y = 0; y < 5; y++) { g.play(BLACK, y * 5 + 1); g.play(WHITE, y * 5 + 3); }
    const s = g.score();
    expect(s.black).toBe(10);
    expect(s.white).toBe(10);
  });
});

describe('sgf', () => {
  it('round-trips moves and handicap', () => {
    const settings: GameSettings = { size: 19, komi: 0.5, handicap: 2, ruleset: 'japanese' };
    const g = new Game(settings);
    g.play(WHITE, 16 * 19 + 15); g.play(BLACK, 2 * 19 + 2); g.pass(WHITE);
    const sgf = toSgf(settings, g.moves, { blackName: 'a]b', whiteName: 'w', result: 'B+R' });
    expect(sgf).toContain('PB[a\\]b]');
    expect(sgf).toContain('AB[pd][dp]');
    const parsed = parseSgf(sgf);
    expect(parsed.size).toBe(19);
    expect(parsed.handicap).toBe(2);
    expect(parsed.props.PB).toEqual(['a]b']);
    expect(parsed.moves).toEqual(g.moves);
    expect(parsed.moves[2].p).toBe(PASS);
  });

  it('follows the first variation only', () => {
    const p = parseSgf('(;SZ[9];B[aa](;W[bb];B[cc])(;W[dd]))');
    expect(p.moves.map((m) => m.p)).toEqual([0, 10, 20]);
  });
});

describe('clock', () => {
  const byo: ClockSettings = { type: 'byoyomi', mainTime: 60_000, periods: 3, periodTime: 30_000 };

  it('uses main time first, then byo-yomi periods', () => {
    let c = initialClock(byo);
    c = chargeMove(byo, c, 50_000).clock;
    expect(c).toEqual({ main: 10_000, periods: 3 });
    c = chargeMove(byo, c, 25_000).clock; // 15s into first period: period kept
    expect(c).toEqual({ main: 0, periods: 3 });
    c = chargeMove(byo, c, 45_000).clock; // overran one period
    expect(c).toEqual({ main: 0, periods: 2 });
    expect(timeUntilFlag(byo, c)).toBe(60_000);
    expect(chargeMove(byo, c, 60_000).timedOut).toBe(true);
  });

  it('displays the running period', () => {
    const d = displayClock(byo, { main: 0, periods: 3 }, 40_000);
    expect(d).toEqual({ main: 0, periods: 2, period: 20_000 });
  });

  it('fischer adds increment up to the cap', () => {
    const f: ClockSettings = { type: 'fischer', mainTime: 60_000, increment: 10_000, maxTime: 65_000 };
    expect(chargeMove(f, initialClock(f), 1_000).clock.main).toBe(65_000);
    expect(chargeMove(f, initialClock(f), 60_000).timedOut).toBe(true);
  });
});

describe('rating', () => {
  it('maps ratings to ranks', () => {
    expect(rankLabel(2000)).toBe('1段');
    expect(rankLabel(1999)).toBe('1級');
    expect(rankLabel(ratingForRank('5k'))).toBe('5級');
    expect(rankLabel(ratingForRank('3d'))).toBe('3段');
  });

  it('winner gains what loser loses for equal K', () => {
    const r = updateRatings({ rating: 1500, games: 30 }, { rating: 1500, games: 30 }, 1);
    expect(r.black).toBe(1510);
    expect(r.white).toBe(1490);
  });
});
