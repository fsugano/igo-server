import { describe, expect, it } from 'vitest';
import { BLACK, WHITE, judgeStyle, openingPointOf, outcomeOf, playerRecord } from '../src/index.js';
import type { Move, StatsGame, Stone } from '../src/index.js';

const S19 = { size: 19, komi: 6.5, handicap: 0, ruleset: 'japanese' as const };
const at = (x: number, y: number, size = 19) => y * size + x;

let t = 0;
function game(color: Stone, result: string, extra: Partial<StatsGame> = {}): StatsGame {
  return {
    id: String(++t),
    color,
    opponent: 'hanako',
    vsBot: false,
    rated: true,
    settings: S19,
    result,
    startedAt: ++t * 1000,
    moves: [],
    ratingBefore: 1500,
    ratingChange: result.startsWith(color === BLACK ? 'B' : 'W') ? 10 : -10,
    ...extra,
  };
}

/** Alternating moves: the player's points and filler moves for the opponent far away. */
function moves(color: Stone, mine: number[], theirs: number[]): Move[] {
  const out: Move[] = [];
  const first: Stone = BLACK;
  for (let i = 0; i < Math.max(mine.length, theirs.length); i++) {
    const pair = color === first ? [[color, mine[i]], [WHITE, theirs[i]]] : [[BLACK, theirs[i]], [color, mine[i]]];
    for (const [c, p] of pair) if (p !== undefined) out.push({ c: c as Stone, p: p as number });
  }
  return out;
}

describe('player record', () => {
  it('reads results from the player side', () => {
    expect(outcomeOf('B+R', BLACK)).toBe('W');
    expect(outcomeOf('B+3.5', WHITE)).toBe('L');
    expect(outcomeOf('Draw', WHITE)).toBe('D');
    expect(outcomeOf(null, WHITE)).toBeNull();
  });

  it('counts wins and losses several ways', () => {
    const r = playerRecord([
      game(BLACK, 'B+R'),
      game(WHITE, 'W+2.5', { vsBot: true, rated: false, opponent: 'AI-Lv2', ratingChange: null }),
      game(BLACK, 'W+T'),
      game(WHITE, 'W+R'),
      game(WHITE, 'W+0.5', { settings: { ...S19, size: 9 } }),
    ]);
    expect(r.total).toEqual({ games: 5, wins: 4, losses: 1, draws: 0 });
    expect(r.asBlack).toEqual({ games: 2, wins: 1, losses: 1, draws: 0 });
    expect(r.vsBot.games).toBe(1);
    expect(r.rated.games).toBe(4);
    expect(r.winsBy).toEqual({ resign: 2, time: 0, points: 2 });
    expect(r.lossesBy).toEqual({ resign: 0, time: 1, points: 0 });
    expect(r.streak).toBe(2);
    expect(r.bestWinStreak).toBe(2);
    expect(r.recent).toEqual(['W', 'W', 'L', 'W', 'W']);
    expect(r.bySize.map((s) => s.size)).toEqual([9, 19]);
    expect(r.ratingHistory).toEqual([
      { at: expect.any(Number), rating: 1510 },
      { at: expect.any(Number), rating: 1490 },
      { at: expect.any(Number), rating: 1510 },
      { at: expect.any(Number), rating: 1510 },
    ]);
    expect(r.opponents[0]).toMatchObject({ name: 'hanako', record: { games: 4 } });
  });
});

describe('play style', () => {
  it('names corner points', () => {
    expect(openingPointOf(3, 3)).toBe('star');
    expect(openingPointOf(3, 2)).toBe('komoku');
    expect(openingPointOf(2, 2)).toBe('sansan');
  });

  it('waits for enough games', () => {
    const s = judgeStyle([game(BLACK, 'B+R')]);
    expect(s.ready).toBe(false);
    expect(s.needGames).toBe(5);
  });

  // The opponent's filler moves: far apart on the 4th-5th lines of the bottom side.
  const filler = Array.from({ length: 15 }, (_, i) => at(1 + i, 13 + (i % 2)));

  it('finds a territory player: low lines, 3-3 points', () => {
    const low = [at(2, 2), at(16, 2), at(2, 16), at(16, 16), ...Array.from({ length: 11 }, (_, i) => at(4 + i, 2))];
    const games = Array.from({ length: 5 }, () => game(BLACK, 'B+5.5', { moves: moves(BLACK, low, filler.map((p) => p + 0)) }));
    const s = judgeStyle(games);
    expect(s.ready).toBe(true);
    expect(s.style).toBe('territory');
    expect(s.openings[0].point).toBe('sansan');
    expect(s.traits).toContain('隅は三々から打つことが多い');
  });

  it('finds an influence player: star points and high moves', () => {
    const high = [at(3, 3), at(15, 3), at(3, 15), at(15, 15), ...Array.from({ length: 11 }, (_, i) => at(4 + i, 5))];
    const games = Array.from({ length: 5 }, () => game(WHITE, 'W+R', { moves: moves(WHITE, high, filler) }));
    const s = judgeStyle(games);
    expect(s.style).toBe('influence');
    expect(s.openings[0].point).toBe('star');
    expect(s.scores.finishing).toBe(100);
  });
});
