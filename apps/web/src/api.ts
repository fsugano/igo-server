import type { ClockSettings, GameSettings, Move, PublicUser } from '@igo/shared';

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `http_${res.status}`);
  return body as T;
}

export interface ProfileGame {
  id: string;
  black: string;
  white: string;
  size: number;
  rated: boolean;
  status: string;
  result: string | null;
  startedAt: number;
  moveCount: number;
  ratingChange: { black: number; white: number } | null;
}

export interface GameRecord {
  id: string;
  black: PublicUser;
  white: PublicUser;
  settings: GameSettings;
  clock: ClockSettings;
  rated: boolean;
  status: 'active' | 'finished';
  result: string | null;
  moves: Move[];
  ratingChange: { black: number; white: number } | null;
  startedAt: number;
}

export const api = {
  me: () => request<{ user: PublicUser | null }>('/api/me'),
  login: (username: string, password: string) =>
    request<{ user: PublicUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string, rank: string) =>
    request<{ user: PublicUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, rank }),
    }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  profile: (username: string) =>
    request<{ user: PublicUser; games: ProfileGame[] }>(`/api/users/${encodeURIComponent(username)}`),
  game: (id: string) => request<GameRecord>(`/api/games/${encodeURIComponent(id)}`),
};

const ERRORS: Record<string, string> = {
  invalid_input: '入力内容を確認してください',
  invalid_username: 'ユーザー名は半角英数字と _ の3〜16文字で入力してください（スペースや日本語は使えません）',
  invalid_password: 'パスワードは8文字以上で入力してください',
  invalid_rank: '棋力を選び直してください',
  username_taken: 'そのユーザー名は使われています',
  bad_credentials: 'ユーザー名かパスワードが違います',
  login_required: 'ログインしてください',
  occupied: 'そこには打てません',
  suicide: '自殺手は打てません',
  ko: 'コウです。他の場所に打ってからにしてください',
  not_your_turn: '相手の手番です',
  already_playing: '対局中は新しい募集ができません',
  too_many_seeks: '募集は3件までです',
  no_such_seek: 'その募集は締め切られました',
  own_seek: '自分の募集には参加できません',
  invalid_seek: '対局条件が正しくありません',
  no_such_engine: 'そのAIは使えません',
  too_many_ai_games: 'AI同士の対局は1人1局までです。終わってから始めてください',
  server_busy: 'AI同士の対局が混み合っています。しばらくしてからお試しください',
  server_error: 'サーバーエラーが発生しました',
};

export const errorText = (code: string) => ERRORS[code] ?? code;
