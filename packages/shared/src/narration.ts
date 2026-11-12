/**
 * Play-by-play commentary for spectators and the recording mode, in Japanese and English.
 * Only builds the sentences; the browser reads them aloud.
 *
 * Fairness: the move lines describe only what is on the board for everyone to see (the move, captures, atari, ko).
 * Comments on who is ahead come only from the spectators' gauge, which already lags behind games a person plays in.
 */
import { BLACK, Board, Stone, opponent } from './board.js';
import type { GameSettings, GameSnapshot } from './game.js';
import type { GaugeEval } from './broadcast.js';

export type NarrationLang = 'ja' | 'en';

export const NARRATION_LANGS: { id: NarrationLang; label: string; voiceLang: string }[] = [
  { id: 'ja', label: '日本語', voiceLang: 'ja-JP' },
  { id: 'en', label: 'English', voiceLang: 'en-US' },
];

export interface NarrationNames {
  black: string;
  white: string;
}

/** One sentence to read aloud. Move lines may be skipped when the game runs faster than speech; others may not. */
export interface NarrationLine {
  text: string;
  kind: 'intro' | 'move' | 'eval' | 'phase' | 'result';
}

const KANJI = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九'];
const COLS = 'ABCDEFGHJKLMNOPQRST';

const colorName = (lang: NarrationLang, c: Stone) => (lang === 'ja' ? (c === BLACK ? '黒' : '白') : c === BLACK ? 'Black' : 'White');

/**
 * How a point is spoken.
 * Japanese: column from the left in numerals, row from the top in kanji ("16の四").
 * English: the letter and number shown beside the board ("Q 16").
 */
export function spokenPoint(lang: NarrationLang, p: number, size: number): string {
  const x = p % size;
  const y = Math.floor(p / size);
  return lang === 'ja' ? `${x + 1}の${KANJI[y + 1]}` : `${COLS[x]} ${size - y}`;
}

/** Where on the board a point is: a named opening point, a corner, a side or the centre. */
export function pointArea(lang: NarrationLang, p: number, size: number): string {
  const x = p % size;
  const y = Math.floor(p / size);
  const mid = (size - 1) / 2;
  if (size % 2 === 1 && x === mid && y === mid) return lang === 'ja' ? '天元' : 'the center point';

  // Distance (0-based) from the nearest edges.
  const dx = Math.min(x, size - 1 - x);
  const dy = Math.min(y, size - 1 - y);
  const edge = size >= 19 ? 5 : size >= 13 ? 4 : 3;
  const h = dx < edge ? (x < mid ? 'left' : 'right') : null;
  const v = dy < edge ? (y < mid ? 'top' : 'bottom') : null;

  if (h && v) {
    const corner =
      lang === 'ja' ? `${h === 'left' ? '左' : '右'}${v === 'top' ? '上' : '下'}` : `${v === 'top' ? 'upper' : 'lower'} ${h}`;
    const named = cornerPointName(lang, dx, dy, size);
    if (named) return lang === 'ja' ? `${corner}の${named}` : `the ${corner} ${named}`;
    return lang === 'ja' ? `${corner}隅` : `the ${corner} corner`;
  }
  if (h) return lang === 'ja' ? `${h === 'left' ? '左' : '右'}辺` : `the ${h} side`;
  if (v) return lang === 'ja' ? `${v === 'top' ? '上' : '下'}辺` : `the ${v === 'top' ? 'top' : 'bottom'} side`;
  return lang === 'ja' ? '中央' : 'the center';
}

/** Names of the usual corner points, counted (0-based) from the two nearest edges. */
function cornerPointName(lang: NarrationLang, dx: number, dy: number, size: number): string | null {
  const [a, b] = dx < dy ? [dx, dy] : [dy, dx];
  const star = size >= 13 ? 3 : 2;
  if (a === star && b === star) return lang === 'ja' ? '星' : 'star point';
  if (size < 13) return null;
  if (a === 2 && b === 2) return lang === 'ja' ? '三々' : '3-3 point';
  if (a === 2 && b === 3) return lang === 'ja' ? '小目' : '3-4 point';
  if (a === 2 && b === 4) return lang === 'ja' ? '目外し' : '3-5 point';
  if (a === 3 && b === 4) return lang === 'ja' ? '高目' : '4-5 point';
  return null;
}

export function narrateIntro(lang: NarrationLang, names: NarrationNames, s: GameSettings): NarrationLine {
  const komi = s.komi % 1 ? `${Math.floor(s.komi)}目半` : `${s.komi}目`;
  const text =
    lang === 'ja'
      ? `${names.black && names.white ? `黒、${names.black}。白、${names.white}。` : ''}${s.size}路盤${s.handicap > 0 ? `、${s.handicap}子局` : `、コミ${komi}`}の対局です。`
      : `${names.black && names.white ? `${names.black} with Black, ${names.white} with White. ` : ''}A ${s.size} by ${s.size} game${s.handicap > 0 ? ` with ${s.handicap} handicap stones` : `, komi ${s.komi}`}.`;
  return { text, kind: 'intro' };
}

/** The lines for the change from one snapshot to the next. Jumps of several moves (e.g. after reconnecting) only describe the latest. */
export function narrateUpdate(lang: NarrationLang, prev: GameSnapshot | null, next: GameSnapshot, names: NarrationNames): NarrationLine[] {
  const out: NarrationLine[] = [];
  const n = next.moves.length;
  if (prev && n > prev.moves.length) {
    const line = narrateMove(lang, prev, next);
    if (line) out.push(line);
  }
  if (prev && prev.phase === 'playing' && next.phase === 'scoring') {
    out.push({
      text: lang === 'ja' ? '両者パスで、整地に入ります。' : 'Both players have passed. The game moves to counting.',
      kind: 'phase',
    });
  }
  if (prev && prev.phase === 'scoring' && next.phase === 'playing') {
    out.push({ text: lang === 'ja' ? '対局が再開されました。' : 'Play resumes.', kind: 'phase' });
  }
  if (prev && prev.phase !== 'finished' && next.phase === 'finished' && next.result) {
    out.push({ text: narrateResult(lang, next.result, names), kind: 'result' });
  }
  return out;
}

function narrateMove(lang: NarrationLang, prev: GameSnapshot, next: GameSnapshot): NarrationLine | null {
  const n = next.moves.length;
  const m = next.moves[n - 1];
  const who = colorName(lang, m.c);
  const size = next.settings.size;
  if (m.p < 0) return { text: lang === 'ja' ? `${n}手目、${who}はパス。` : `Move ${n}. ${who} passes.`, kind: 'move' };

  const parts: string[] = [];
  const area = pointArea(lang, m.p, size);
  const point = spokenPoint(lang, m.p, size);
  parts.push(lang === 'ja' ? `${n}手目、${who}、${area}、${point}。` : `Move ${n}. ${who} plays ${point}, ${area}.`);

  const key = m.c === BLACK ? 'black' : 'white';
  const took = next.captures[key] - prev.captures[key];
  if (took > 0) parts.push(lang === 'ja' ? `${took}子を取りました。` : `${who} captures ${took} stone${took > 1 ? 's' : ''}.`);

  const board = new Board(size, Uint8Array.from(next.cells));
  if (next.koPoint >= 0 && took === 1) {
    parts.push(lang === 'ja' ? 'コウです。' : 'It is a ko.');
  } else {
    const foe = opponent(m.c);
    const seen = new Set<number>();
    let atari = false;
    for (const q of board.neighbors(m.p)) {
      if (board.get(q) !== foe || seen.has(q)) continue;
      const ch = board.chain(q);
      ch.stones.forEach((s) => seen.add(s));
      if (ch.liberties.size === 1) atari = true;
    }
    if (atari) parts.push(lang === 'ja' ? 'アタリです。' : 'Atari!');
  }
  return { text: parts.join(lang === 'ja' ? '' : ' '), kind: 'move' };
}

export function narrateResult(lang: NarrationLang, result: string, names: NarrationNames): string {
  if (result === 'Draw') return lang === 'ja' ? '持碁、引き分けです。' : 'The game is a draw.';
  const c: Stone = result.startsWith('B') ? BLACK : opponent(BLACK);
  const name = c === BLACK ? names.black : names.white;
  const who = colorName(lang, c);
  // Without a name (no consent to appear in videos), only the colour is said.
  const subject = lang === 'ja' ? (name ? `${who}、${name}` : who) : name ? `${name}, ${who},` : who;
  const how = result.slice(2);
  if (lang === 'ja') {
    if (how === 'R') return `${subject}の中押し勝ちです。`;
    if (how === 'T') return `${subject}の時間勝ちです。`;
    const v = Number(how);
    const whole = Math.floor(v);
    return `${subject}の${whole ? `${whole}目` : ''}${v % 1 ? '半' : ''}勝ちです。`;
  }
  if (how === 'R') return `${subject} wins by resignation.`;
  if (how === 'T') return `${subject} wins on time.`;
  return `${subject} wins by ${how} point${how === '1' ? '' : 's'}.`;
}

/** Comment on the spectators' gauge when it swings, or at regular intervals. Says which move it refers to, since it may lag. */
export function narrateEval(lang: NarrationLang, prev: GaugeEval | undefined, cur: GaugeEval, every = 20): NarrationLine | null {
  const swing = prev ? Math.abs(cur.winrateBlack - prev.winrateBlack) : 0;
  const crossed = prev ? Math.floor(cur.moveNumber / every) > Math.floor(prev.moveNumber / every) : false;
  if (swing < 0.15 && !crossed) return null;

  const w = cur.winrateBlack;
  const lead: Stone = w >= 0.5 ? BLACK : opponent(BLACK);
  const pct = Math.round((lead === BLACK ? w : 1 - w) * 100);
  const gap = Math.abs(w - 0.5);
  const reversed = !!prev && (prev.winrateBlack - 0.5) * (w - 0.5) < 0 && gap >= 0.05;
  const who = colorName(lang, lead);
  if (lang === 'ja') {
    const head = `${cur.moveNumber}手目の時点の形勢です。`;
    if (gap < 0.08) return { text: `${head}ほぼ互角です。`, kind: 'eval' };
    const state = gap < 0.25 ? 'やや優勢' : '優勢';
    return { text: `${head}${reversed ? '形勢逆転、' : swing >= 0.15 ? '大きく動いて、' : ''}${who}${state}、勝率${pct}パーセント。`, kind: 'eval' };
  }
  const head = `As of move ${cur.moveNumber},`;
  if (gap < 0.08) return { text: `${head} the game is about even.`, kind: 'eval' };
  const state = gap < 0.25 ? 'slightly ahead' : 'ahead';
  return {
    text: `${head} ${reversed ? 'the lead has changed hands. ' : swing >= 0.15 ? 'a big swing. ' : ''}${who} is ${state}, with a ${pct} percent chance to win.`.replace(/\. (\w)/, (_, c: string) => `. ${c.toUpperCase()}`),
    kind: 'eval',
  };
}
