import { rankLabel, ratingForRank } from './rating.js';

/** Games needed for each level from Lv1; after the last, one level per 100 games. */
const LEVEL_STEPS = [0, 5, 10, 20, 30, 50, 75, 100, 150, 200];

/** The user level for a number of completed games (how much someone has played, not how strong they are). */
export function levelFor(gamesCompleted: number): number {
  const n = Math.max(0, Math.floor(gamesCompleted));
  const last = LEVEL_STEPS[LEVEL_STEPS.length - 1];
  if (n >= last) return LEVEL_STEPS.length + Math.floor((n - last) / 100);
  let lv = 1;
  for (let i = 0; i < LEVEL_STEPS.length; i++) if (n >= LEVEL_STEPS[i]) lv = i + 1;
  return lv;
}

/** Games needed to reach a level. */
export function gamesForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level <= LEVEL_STEPS.length) return LEVEL_STEPS[level - 1];
  return LEVEL_STEPS[LEVEL_STEPS.length - 1] + (level - LEVEL_STEPS.length) * 100;
}

/** Rated games before the declared rank stops resetting the rating. */
export const DECLARED_RANK_GAMES = 5;
/** Moves (by both players) a finished game needs to count towards the level. */
export const LEVEL_MIN_MOVES = 4;
/** Per day: games against the computer, and against the same person, that count towards the level. */
export const LEVEL_DAILY_AI_GAMES = 10;
export const LEVEL_DAILY_SAME_OPPONENT = 5;

export const DISPLAY_NAME_MAX = 20;

/** Words that would let someone pass for the operators or a computer player. */
const RESERVED = [/運営/, /公式/, /管理者/, /admin/i, /staff/i, /moderator/i, /official/i, /^ai[-_ ]/i];

/** Normalises a nickname, or returns an error code. */
export function checkDisplayName(input: unknown): { name: string } | { error: string } {
  if (typeof input !== 'string') return { error: 'invalid_display_name' };
  const name = input.normalize('NFKC').trim();
  const length = [...name].length;
  if (length < 1 || length > DISPLAY_NAME_MAX) return { error: 'invalid_display_name' };
  // Control, format (zero-width etc.), private-use and unassigned characters; line breaks.
  if (/[\p{C}\p{Zl}\p{Zp}]/u.test(name)) return { error: 'invalid_display_name' };
  if (RESERVED.some((r) => r.test(name))) return { error: 'reserved_display_name' };
  return { name };
}

/** Ranks a person can declare, strongest first: 9d … 1d, 1k … 30k. */
export const DECLARABLE_RANKS: string[] = [
  ...Array.from({ length: 9 }, (_, i) => `${9 - i}d`),
  ...Array.from({ length: 30 }, (_, i) => `${i + 1}k`),
];

/** "3k" → "3級". */
export const declaredRankLabel = (rank: string) => rankLabel(ratingForRank(rank));
