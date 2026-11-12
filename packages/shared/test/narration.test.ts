import { describe, expect, it } from 'vitest';
import { Game, narrateEval, narrateIntro, narrateResult, narrateUpdate, pointArea, spokenPoint } from '../src/index.js';
import type { GameSettings } from '../src/index.js';

const S19: GameSettings = { size: 19, komi: 6.5, handicap: 0, ruleset: 'japanese' };
const S9: GameSettings = { size: 9, komi: 6.5, handicap: 0, ruleset: 'japanese' };
const names = { black: 'taro', white: 'AI-Lv2' };
const at = (size: number, x: number, y: number) => y * size + x;

describe('narration', () => {
  it('names points the Japanese and English way', () => {
    // Upper right star point on 19x19: Q16.
    const p = at(19, 15, 3);
    expect(spokenPoint('ja', p, 19)).toBe('16の四');
    expect(spokenPoint('en', p, 19)).toBe('Q 16');
    expect(pointArea('ja', p, 19)).toBe('右上の星');
    expect(pointArea('en', p, 19)).toBe('the upper right star point');
  });

  it('describes areas of the board', () => {
    expect(pointArea('ja', at(19, 9, 9), 19)).toBe('天元');
    expect(pointArea('ja', at(19, 2, 15), 19)).toBe('左下の小目');
    expect(pointArea('ja', at(19, 2, 2), 19)).toBe('左上の三々');
    expect(pointArea('ja', at(19, 0, 9), 19)).toBe('左辺');
    expect(pointArea('ja', at(19, 9, 17), 19)).toBe('下辺');
    expect(pointArea('ja', at(19, 7, 7), 19)).toBe('中央');
    expect(pointArea('en', at(19, 9, 1), 19)).toBe('the top side');
  });

  it('narrates a move, a pass and the start', () => {
    const g = new Game(S19);
    const before = g.snapshot();
    g.play(BLACK_, at(19, 15, 3));
    const [line] = narrateUpdate('ja', before, g.snapshot(), names);
    expect(line).toEqual({ text: '1手目、黒、右上の星、16の四。', kind: 'move' });
    const s1 = g.snapshot();
    g.pass(WHITE_);
    expect(narrateUpdate('en', s1, g.snapshot(), names)[0].text).toBe('Move 2. White passes.');
    expect(narrateIntro('ja', names, S19).text).toBe('黒、taro。白、AI-Lv2。19路盤、コミ6目半の対局です。');
  });

  it('calls captures', () => {
    const g = new Game(S9);
    g.play(BLACK_, at(9, 1, 0));
    g.play(WHITE_, at(9, 0, 0));
    const prev = g.snapshot();
    g.play(BLACK_, at(9, 0, 1));
    expect(narrateUpdate('ja', prev, g.snapshot(), names)[0].text).toBe('3手目、黒、左上隅、1の二。1子を取りました。');
    expect(narrateUpdate('en', prev, g.snapshot(), names)[0].text).toBe('Move 3. Black plays A 8, the upper left corner. Black captures 1 stone.');
  });

  it('says atari when a group is left with one liberty', () => {
    const g = new Game(S9);
    g.play(BLACK_, at(9, 4, 3));
    g.play(WHITE_, at(9, 4, 4));
    g.play(BLACK_, at(9, 3, 4));
    g.play(WHITE_, at(9, 0, 0));
    const prev = g.snapshot();
    g.play(BLACK_, at(9, 5, 4));
    expect(narrateUpdate('ja', prev, g.snapshot(), names)[0].text).toContain('アタリです');
    expect(narrateUpdate('en', prev, g.snapshot(), names)[0].text).toContain('Atari!');
  });

  it('announces counting and the result', () => {
    const g = new Game(S9);
    g.pass(BLACK_);
    const prev = g.snapshot();
    g.pass(WHITE_);
    const lines = narrateUpdate('ja', prev, g.snapshot(), names);
    expect(lines.map((l) => l.kind)).toEqual(['move', 'phase']);
    expect(narrateResult('ja', 'W+R', names)).toBe('白、AI-Lv2の中押し勝ちです。');
    expect(narrateResult('ja', 'B+3.5', names)).toBe('黒、taroの3目半勝ちです。');
    expect(narrateResult('en', 'B+3.5', names)).toBe('taro, Black, wins by 3.5 points.');
    // No consent to appear in videos: colours only.
    const anon = { black: '', white: '' };
    expect(narrateResult('ja', 'W+R', anon)).toBe('白の中押し勝ちです。');
    expect(narrateResult('en', 'W+T', anon)).toBe('White wins on time.');
    expect(narrateIntro('ja', anon, S19).text).toBe('19路盤、コミ6目半の対局です。');
  });

  it('comments on the gauge only on swings and at intervals', () => {
    expect(narrateEval('ja', { moveNumber: 10, winrateBlack: 0.5 }, { moveNumber: 11, winrateBlack: 0.55 })).toBeNull();
    const swing = narrateEval('ja', { moveNumber: 10, winrateBlack: 0.4 }, { moveNumber: 11, winrateBlack: 0.7 });
    expect(swing?.text).toBe('11手目の時点の形勢です。形勢逆転、黒やや優勢、勝率70パーセント。');
    const even = narrateEval('en', { moveNumber: 19, winrateBlack: 0.5 }, { moveNumber: 20, winrateBlack: 0.52 });
    expect(even?.text).toBe('As of move 20, the game is about even.');
  });
});

const BLACK_ = 1 as const;
const WHITE_ = 2 as const;
