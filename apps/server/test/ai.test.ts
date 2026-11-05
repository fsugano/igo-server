import { BLACK, Game, PASS, WHITE } from '@igo/shared';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { BUILTIN_LEVELS, BuiltinEngine, FastBoard, analyze, rng } from '../src/ai/builtin.js';
import { BuiltinEvaluator } from '../src/ai/gauge.js';
import { GtpEngine, fromVertex, toVertex } from '../src/ai/gtp.js';
import { loadEngines } from '../src/ai/index.js';

const S9 = { size: 9, komi: 6.5, handicap: 0, ruleset: 'japanese' as const };

/** Game from rows of '.', 'X', 'O' with the given side to move (built by placing stones as moves). */
function position(rows: string[], toMove = BLACK): Game {
  const g = new Game(S9);
  const b: number[] = [];
  const w: number[] = [];
  rows.forEach((r, y) => [...r].forEach((ch, x) => (ch === 'X' ? b : ch === 'O' ? w : []).push(y * 9 + x)));
  while (b.length || w.length) {
    const list = g.toMove === BLACK ? b : w;
    const err = list.length ? g.play(g.toMove, list.shift()!) : g.pass(g.toMove);
    if (err) throw new Error(err);
  }
  if (g.toMove !== toMove) g.pass(g.toMove);
  return g;
}

describe('FastBoard', () => {
  it('captures, forbids suicide and tracks ko like the shared rules', () => {
    const g = position(['.XO......', 'XO.O.....', '.XO......', '.........', '.........', '.........', '.........', '.........', '.........']);
    const b = FastBoard.fromGame(g);
    expect(b.play(11, BLACK)).toBe(true); // black at C8 captures B8
    expect(b.cells[10]).toBe(0);
    expect(b.ko).toBe(10);
    expect(b.play(10, WHITE)).toBe(false); // immediate ko recapture
  });

  it('agrees with the shared rules over random games', () => {
    const rand = rng(42);
    for (let game = 0; game < 20; game++) {
      const g = new Game(S9);
      const fb = FastBoard.fromGame(g);
      for (let m = 0; m < 150; m++) {
        const p = Math.floor(rand() * 81);
        const legal = g.play(g.toMove, p) === null;
        expect(fb.play(p, legal ? 3 - g.toMove : g.toMove)).toBe(legal);
        if (!legal) continue;
        expect(Array.from(fb.cells)).toEqual(Array.from(g.board.cells));
        expect(fb.ko).toBe(g.koPoint);
      }
    }
  });
});

describe('built-in evaluator', () => {
  // Black walls off almost all of the board; white has a small corner.
  const rows = ['....X.O..', '....X.OO.', '....X....', '....X....', '....X....', '....X....', '....X....', '....X....', '....X....'];
  const blackWide = rows;
  const whiteWide = rows.map((r) => [...r].map((c) => (c === 'X' ? 'O' : c === 'O' ? 'X' : c)).join(''));

  it("reports black's chances whoever is to move", async () => {
    const ev = new BuiltinEvaluator({ playouts: 1500, maxMs: 5000 });
    for (const toMove of [BLACK, WHITE] as const) {
      // A wall on the fifth column gives its owner the larger left side.
      expect(await ev.evaluate(position(blackWide, toMove))).toBeGreaterThan(0.6);
      expect(await ev.evaluate(position(whiteWide, toMove))).toBeLessThan(0.4);
    }
  });
});

describe('built-in engine', () => {
  it('kills a group in atari', async () => {
    // White's three stones have one liberty at E5 (40); capturing there or blocking at E4 (49) both kill.
    const g = position([
      '.........',
      '.........',
      '...XXX...',
      '..XOOOX..',
      '..XX.XX..',
      '.........',
      '.........',
      '.........',
      '.........',
    ]);
    const a = await analyze(g, BLACK, { playouts: 1500, seed: 7 });
    expect([40, 49]).toContain(a.best);
    expect(a.winrate).toBeGreaterThan(0.8);
  });

  it('passes when only its own eyes are left', async () => {
    const rows = Array.from({ length: 9 }, (_, y) => (y % 2 ? 'X.X.X.X.X' : 'XXXXXXXXX'));
    const g = new Game(S9);
    for (const [y, r] of rows.entries()) for (const [x, ch] of [...r].entries()) if (ch === 'X') {
      g.play(BLACK, y * 9 + x);
      g.pass(WHITE);
    }
    const e = new BuiltinEngine(BUILTIN_LEVELS[0], 1);
    expect(await e.genMove(g, BLACK)).toEqual({ type: 'pass' });
  });

  it('ships three levels and adds GTP engines from the environment', () => {
    expect(loadEngines({}).map((e) => e.username)).toEqual(['AI-Lv1', 'AI-Lv2', 'AI-Lv3']);
    const env = { AI_GTP_ENGINES: JSON.stringify([{ id: 'katago', name: 'KataGo', rank: '9d', command: 'katago', args: ['gtp'] }]) };
    const list = loadEngines(env);
    expect(list[3]).toMatchObject({ id: 'gtp-katago', username: 'AI-KataGo', rank: '9d' });
  });
});

describe('GTP engine', () => {
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-gtp.mjs');
  const e = new GtpEngine({ id: 'gtp-fake', username: 'AI-Fake', label: 'Fake', rank: '1d', command: process.execPath, args: [fixture] });
  afterAll(() => e.close());

  it('converts vertices (no I column, rows from the bottom)', () => {
    expect(toVertex(0, 19)).toBe('A19');
    expect(toVertex(18 * 19 + 8, 19)).toBe('J1');
    expect(fromVertex('j1', 19)).toBe(18 * 19 + 8);
    expect(fromVertex('pass', 9)).toBe('pass');
    expect(fromVertex('Z99', 9)).toBeNull();
  });

  it('replays the game and asks for a move', async () => {
    const g = new Game(S9);
    g.play(BLACK, 0); // A9
    expect(await e.genMove(g, WHITE)).toEqual({ type: 'play', p: 1 });
    g.play(WHITE, 1);
    g.pass(BLACK);
    expect(await e.genMove(g, WHITE)).toEqual({ type: 'play', p: 2 });
    expect(await e.deadStones(g)).toEqual([8 * 9, 7 * 9 + 1]);
    expect(g.moves.at(-1)!.p).toBe(PASS);
  });
});
