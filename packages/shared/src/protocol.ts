import type { GaugeState } from './broadcast.js';
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
  /** A computer player. */
  bot: boolean;
  /** Nickname shown first; the username when none is set. */
  displayName: string;
  /** 256×256 WebP, or null for the default picture. The 64×64 one is at the same path with -64 instead of -256. */
  avatarUrl: string | null;
  /** How much the person has played (not how strong they are). */
  level: number;
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

/** A computer player that can be picked for a game. */
export interface AiEngineInfo {
  id: string;
  label: string;
  user: PublicUser;
}

/** Starts a game against the computer (one side null = the requesting user) or between two engines. */
export interface AiGameRequest {
  size: 9 | 13 | 19;
  komi: number;
  handicap: number;
  ruleset: Ruleset;
  clock: ClockSettings;
  /** Engine id, or null for the requesting user. */
  black: string | null;
  white: string | null;
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

/** What someone in the online list is doing. */
export type PresenceStatus = 'available' | 'playing' | 'playing_ai' | 'busy';

export interface OnlineUser extends PublicUser {
  status: PresenceStatus;
  /** The game being played, for "watch". */
  gameId?: string;
}

export interface LobbyState {
  seeks: Seek[];
  games: GameSummary[];
  online: OnlineUser[];
}

/** A game offered to one particular person. The colour is from the challenger's side. */
export type ChallengeRequest = SeekRequest;

export interface Challenge {
  id: string;
  from: PublicUser;
  to: PublicUser;
  request: ChallengeRequest;
  /** Server time (ms) when it lapses. */
  expiresAt: number;
  /** Set on a counter-offer: the challenge it answers. A counter-offer cannot be countered again. */
  counterOf?: string;
}

export type ChallengeOutcome = 'accepted' | 'declined' | 'expired' | 'cancelled' | 'countered';

export interface ChallengeUpdate {
  id: string;
  outcome: ChallengeOutcome;
  /** Set phrase given when declining. */
  reason?: string;
  gameId?: string;
  /** The counter-offer that replaced it. */
  counter?: Challenge;
}

/** Set phrases for declining (free text is not allowed, so nothing rude can be sent this way). */
export const DECLINE_REASONS = ['今は打てません', '持ち時間が合いません', '盤の大きさが合いません', 'また今度お願いします'] as const;

export interface LobbyChatMessage {
  id: string;
  user: PublicUser;
  text: string;
  at: number;
}

export interface DirectMessage {
  id: string;
  fromId: string;
  toId: string;
  text: string;
  at: number;
  /** When the recipient opened it, null while unread. */
  readAt: number | null;
}

/** One person I have messages with, for the list of conversations. */
export interface Conversation {
  user: PublicUser;
  last: DirectMessage;
  unread: number;
}

export type NewsCategory = 'info' | 'maintenance' | 'update' | 'event';
export const NEWS_CATEGORIES: Record<NewsCategory, string> = {
  info: 'お知らせ',
  maintenance: 'メンテナンス',
  update: 'アップデート',
  event: 'イベント',
};

export interface NewsItem {
  id: string;
  title: string;
  /** Markdown (raw HTML is not rendered). */
  body: string;
  category: NewsCategory;
  important: boolean;
  pinned: boolean;
  /** null while a draft. */
  publishAt: number | null;
  expireAt: number | null;
}

export type Ack<T = {}> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
  /** The chat history comes only to logged-in users. */
  'lobby:join': (ack: Ack<{ lobby: LobbyState; chat: LobbyChatMessage[] }>) => void;
  'lobbychat:send': (text: string, ack: Ack) => void;
  'presence:setStatus': (status: 'available' | 'busy', ack: Ack) => void;
  'challenge:create': (userId: string, req: ChallengeRequest, ack: Ack<{ challenge: Challenge }>) => void;
  'challenge:respond': (
    challengeId: string,
    answer: 'accept' | 'decline' | 'counter',
    detail: { reason?: string; request?: ChallengeRequest },
    ack: Ack<{ gameId?: string; challenge?: Challenge }>,
  ) => void;
  'challenge:cancel': (challengeId: string, ack: Ack) => void;
  /** Challenges to and from me still open (e.g. after reloading the page). */
  'challenge:list': (ack: Ack<{ challenges: Challenge[] }>) => void;
  'lobby:leave': () => void;
  /** People I follow (their ids). */
  'follow:list': (ack: Ack<{ ids: string[] }>) => void;
  'follow:set': (userId: string, follow: boolean, ack: Ack) => void;
  'dm:conversations': (ack: Ack<{ conversations: Conversation[] }>) => void;
  /** The latest messages with this person, oldest first. Marks the ones to me as read. */
  'dm:history': (userId: string, ack: Ack<{ user: PublicUser; messages: DirectMessage[] }>) => void;
  'dm:send': (userId: string, text: string, ack: Ack<{ message: DirectMessage }>) => void;
  'dm:read': (userId: string, ack: Ack) => void;
  'seek:create': (req: SeekRequest, ack: Ack<{ seek: Seek }>) => void;
  'seek:cancel': (seekId: string, ack: Ack) => void;
  'seek:accept': (seekId: string, ack: Ack<{ gameId: string }>) => void;
  'ai:engines': (ack: Ack<{ engines: AiEngineInfo[] }>) => void;
  'ai:start': (req: AiGameRequest, ack: Ack<{ gameId: string }>) => void;
  'game:join': (gameId: string, ack: Ack<{ game: GameView }>) => void;
  'game:leave': (gameId: string) => void;
  'game:move': (gameId: string, point: number, moveNumber: number, ack: Ack) => void;
  'game:pass': (gameId: string, moveNumber: number, ack: Ack) => void;
  'game:resign': (gameId: string, ack: Ack) => void;
  'game:toggleDead': (gameId: string, point: number, ack: Ack) => void;
  'game:acceptScore': (gameId: string, ack: Ack) => void;
  'game:resume': (gameId: string, ack: Ack) => void;
  'game:chat': (gameId: string, text: string, ack: Ack) => void;
  /** Spectators only: receive the evaluation gauge of a live game (refused for its players). */
  'gauge:watch': (gameId: string, ack: Ack<{ gauge: GaugeState }>) => void;
  'gauge:unwatch': (gameId: string) => void;
}

export interface ServerToClientEvents {
  'lobby:state': (lobby: LobbyState) => void;
  'lobbychat:message': (msg: LobbyChatMessage) => void;
  'challenge:received': (challenge: Challenge) => void;
  'challenge:updated': (update: ChallengeUpdate) => void;
  /** A message to or from me (sent to all my tabs). */
  'dm:message': (msg: DirectMessage, from: PublicUser) => void;
  /** My own details changed (rating, level after a game). */
  'user:updated': (user: PublicUser) => void;
  /** A news item has just become visible (the body is fetched when opened). */
  'news:published': (item: Omit<NewsItem, 'body'>) => void;
  'game:start': (gameId: string) => void;
  'game:update': (game: GameView) => void;
  'game:chat': (gameId: string, msg: ChatMessage) => void;
  'gauge:update': (gauge: GaugeState) => void;
}
