import { BLACK, Board, EMPTY, WHITE } from './board.js';

export type Ruleset = 'japanese' | 'chinese';

export interface ScoreInput {
  board: Board;
  /** Points of stones agreed dead. */
  dead: Iterable<number>;
  /** Stones captured during play (prisoners held by black / white). */
  capturesByBlack: number;
  capturesByWhite: number;
  komi: number;
  ruleset: Ruleset;
}

export interface Score {
  black: number;
  white: number;
  /** Ownership per point: 1 black, 2 white, 0 neutral (dame / seki). */
  ownership: number[];
  blackTerritory: number;
  whiteTerritory: number;
  blackStones: number;
  whiteStones: number;
  blackPrisoners: number;
  whitePrisoners: number;
  /** Positive: black wins by this much. Negative: white wins. */
  margin: number;
}

/**
 * Territory scoring (Japanese: territory + prisoners) or area scoring
 * (Chinese: territory + stones on board). Dead stones are removed first;
 * under Japanese rules they count as prisoners.
 * Note: empty regions surrounded by one colour count as territory, so eyes
 * in seki are not excluded under Japanese rules (MVP limitation).
 */
export function score(input: ScoreInput): Score {
  const { board, komi, ruleset } = input;
  const dead = new Set(input.dead);
  let blackPrisoners = input.capturesByBlack;
  let whitePrisoners = input.capturesByWhite;
  const cells = board.cells.slice();
  for (const p of dead) {
    if (cells[p] === BLACK) whitePrisoners++;
    else if (cells[p] === WHITE) blackPrisoners++;
    cells[p] = EMPTY;
  }
  const b = new Board(board.size, cells);
  const ownership = new Array<number>(cells.length).fill(0);
  const seen = new Uint8Array(cells.length);
  let blackTerritory = 0;
  let whiteTerritory = 0;
  let blackStones = 0;
  let whiteStones = 0;

  for (let p = 0; p < cells.length; p++) {
    if (cells[p] === BLACK) {
      blackStones++;
      ownership[p] = BLACK;
      continue;
    }
    if (cells[p] === WHITE) {
      whiteStones++;
      ownership[p] = WHITE;
      continue;
    }
    if (seen[p]) continue;
    const region: number[] = [];
    let borders = 0;
    const stack = [p];
    seen[p] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      region.push(q);
      for (const n of b.neighbors(q)) {
        const c = cells[n];
        if (c === EMPTY) {
          if (!seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        } else borders |= c;
      }
    }
    if (borders === BLACK || borders === WHITE) {
      for (const q of region) ownership[q] = borders;
      if (borders === BLACK) blackTerritory += region.length;
      else whiteTerritory += region.length;
    }
  }

  let black: number;
  let white: number;
  if (ruleset === 'chinese') {
    black = blackTerritory + blackStones;
    white = whiteTerritory + whiteStones + komi;
  } else {
    black = blackTerritory + blackPrisoners;
    white = whiteTerritory + whitePrisoners + komi;
  }
  return {
    black,
    white,
    ownership,
    blackTerritory,
    whiteTerritory,
    blackStones,
    whiteStones,
    blackPrisoners,
    whitePrisoners,
    margin: black - white,
  };
}
