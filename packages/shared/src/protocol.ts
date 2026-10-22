import type { ClockSettings, PlayerClock } from './clock.js';
import type { GameSnapshot } from './game.js';
import type { Ruleset } from './scoring.js';

export interface PublicUser {
  id: string;
  username: string;
  rating: number;
  rank: string;
  gamesPlayed: number;
  premium: boolean;
}

export interface SeekRequest {
  size: 9 | 13 | 19;
  komi: number;
  handicap: number;
  ruleset: Ruleset;
  clock: ClockSettings;
  rated: boolean;
  /** Which colour the creator takes. */
  color: 'black' | 'white' | 'random';
}

export interface Seek extends SeekRequest {
  id: string;
  creator: PublicUser;
  createdAt: number;
}

export interface GameSummary {
  id: string;
  black: PublicUser;
  white: PublicUser;
  size: number;
  moveCount: number;
  rated: boolean;
  status: 'active' | 'finished';
  result: string | null;
  startedAt: number;
}

export interface ChatMessage {
  user: string;
  text: string;
  at: number;
}

export interface GameView {
  id: string;
  black: PublicUser;
  white: PublicUser;
  rated: boolean;
  clock: ClockSettings;
  clocks: { black: PlayerClock; white: PlayerClock };
  /** Server time (ms) when the current turn's clock started, null if no clock is running. */
  turnStartedAt: number | null;
  serverNow: number;
  state: GameSnapshot;
  spectators: number;
  chat: ChatMessage[];
  ratingChange?: { black: number; white: number } | null;
}

export interface LobbyState {
  seeks: Seek[];
  games: GameSummary[];
  online: PublicUser[];
}

export type Ack<T = {}> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
  'lobby:join': (ack: Ack<{ lobby: LobbyState }>) => void;
  'lobby:leave': () => void;
  'seek:create': (req: SeekRequest, ack: Ack<{ seek: Seek }>) => void;
  'seek:cancel': (seekId: string, ack: Ack) => void;
  'seek:accept': (seekId: string, ack: Ack<{ gameId: string }>) => void;
  'game:join': (gameId: string, ack: Ack<{ game: GameView }>) => void;
  'game:leave': (gameId: string) => void;
  'game:move': (gameId: string, point: number, moveNumber: number, ack: Ack) => void;
  'game:pass': (gameId: string, moveNumber: number, ack: Ack) => void;
  'game:resign': (gameId: string, ack: Ack) => void;
  'game:toggleDead': (gameId: string, point: number, ack: Ack) => void;
  'game:acceptScore': (gameId: string, ack: Ack) => void;
  'game:resume': (gameId: string, ack: Ack) => void;
  'game:chat': (gameId: string, text: string, ack: Ack) => void;
}

export interface ServerToClientEvents {
  'lobby:state': (lobby: LobbyState) => void;
  'game:start': (gameId: string) => void;
  'game:update': (game: GameView) => void;
  'game:chat': (gameId: string, msg: ChatMessage) => void;
}
