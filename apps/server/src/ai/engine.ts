import { Game, Stone } from '@igo/shared';

export type EngineMove = { type: 'play'; p: number } | { type: 'pass' } | { type: 'resign' };

/**
 * A computer player. The game passed in is a private copy: engines may read it freely.
 * Implementations: the built-in Monte Carlo engine (builtin.ts) and any GTP program such as KataGo (gtp.ts).
 */
export interface Engine {
  /** Stable id, stored on the bot's user row. */
  readonly id: string;
  /** Bot account name shown on the board, e.g. "AI-Lv1". Must not be a valid human username. */
  readonly username: string;
  /** Label in the AI picker. */
  readonly label: string;
  /** Rank shown for the bot account, e.g. "20k". */
  readonly rank: string;
  genMove(game: Game, color: Stone): Promise<EngineMove>;
  /** Points of stones this engine considers dead, for the scoring phase. */
  deadStones(game: Game): Promise<number[]>;
  close?(): void;
}
