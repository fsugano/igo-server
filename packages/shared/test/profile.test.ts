import { describe, expect, it } from 'vitest';
import { checkDisplayName, declaredRankLabel, gamesForLevel, levelFor } from '../src/index.js';

describe('user level', () => {
  it('follows the table, then one level per 100 games', () => {
    expect([0, 4, 5, 9, 10, 20, 30, 49, 50, 75, 100, 150, 199, 200, 299, 300].map(levelFor)).toEqual([
      1, 1, 2, 2, 3, 4, 5, 5, 6, 7, 8, 9, 9, 10, 10, 11,
    ]);
    for (let lv = 1; lv < 15; lv++) expect(levelFor(gamesForLevel(lv))).toBe(lv);
  });
});

describe('nickname', () => {
  it('normalises and checks', () => {
    expect(checkDisplayName('  たろう ')).toEqual({ name: 'たろう' });
    expect(checkDisplayName('ＴＡＲＯ')).toEqual({ name: 'TARO' });
    expect(checkDisplayName('')).toEqual({ error: 'invalid_display_name' });
    expect(checkDisplayName('a'.repeat(21))).toEqual({ error: 'invalid_display_name' });
    expect(checkDisplayName('😀'.repeat(20))).toEqual({ name: '😀'.repeat(20) });
    expect(checkDisplayName('ta​ro')).toEqual({ error: 'invalid_display_name' });
    expect(checkDisplayName('ta\nro')).toEqual({ error: 'invalid_display_name' });
    expect(checkDisplayName('囲碁運営')).toEqual({ error: 'reserved_display_name' });
    expect(checkDisplayName('Ａｄｍｉｎ')).toEqual({ error: 'reserved_display_name' });
    expect(checkDisplayName('AI-Lv9')).toEqual({ error: 'reserved_display_name' });
  });

  it('labels declared ranks', () => {
    expect(declaredRankLabel('3k')).toBe('3級');
    expect(declaredRankLabel('2d')).toBe('2段');
  });
});
