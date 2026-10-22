/** Elo-style rating. 2000 = 1 dan, 1900 = 1 kyu; 100 points per rank. */
export const DAN_1 = 2000;

export function rankLabel(rating: number): string {
  const n = Math.floor((rating - DAN_1) / 100);
  if (n >= 0) return `${Math.min(n + 1, 9)}段`;
  return `${Math.min(-n, 30)}級`;
}

/** Rating at the bottom of the band for a declared rank, e.g. "3k" or "2d". */
export function ratingForRank(rank: string): number {
  const m = /^(\d+)([kd])$/i.exec(rank.trim());
  if (!m) throw new Error('invalid rank');
  const n = Number(m[1]);
  if (m[2].toLowerCase() === 'd') {
    if (n < 1 || n > 9) throw new Error('invalid rank');
    return DAN_1 + (n - 1) * 100 + 50;
  }
  if (n < 1 || n > 30) throw new Error('invalid rank');
  return DAN_1 - n * 100 + 50;
}

export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < 20 ? 40 : 20;
}

/**
 * New ratings after a game. score is 1 (black wins), 0 (white wins) or 0.5.
 * Handicap stones are worth roughly one rank each for black.
 */
export function updateRatings(
  black: { rating: number; games: number },
  white: { rating: number; games: number },
  scoreForBlack: number,
  handicap = 0,
): { black: number; white: number } {
  const bonus = handicap >= 2 ? handicap * 100 : 0;
  const eb = expectedScore(black.rating + bonus, white.rating);
  const nb = black.rating + kFactor(black.games) * (scoreForBlack - eb);
  const nw = white.rating + kFactor(white.games) * (1 - scoreForBlack - (1 - eb));
  const round = (x: number) => Math.round(x * 10) / 10;
  return { black: round(nb), white: round(nw) };
}
