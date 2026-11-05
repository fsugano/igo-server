/** Settings the operators can change from the admin screen, and the live evaluation gauge. */

/** How the recording mode captures video. Only implemented methods can be selected. */
export type RecordingMethod = 'tab' | 'canvas' | 'webcodecs';

export const RECORDING_METHODS: { id: RecordingMethod; label: string; description: string; implemented: boolean }[] = [
  {
    id: 'tab',
    label: 'A. タブの収録',
    description: 'ブラウザの画面共有で今のタブを選び、収録範囲だけを切り抜いて保存します',
    implemented: true,
  },
  {
    id: 'canvas',
    label: 'B. 描画を直接収録',
    description: '収録画面を Canvas に描いて保存します。許可の画面が出ず、マウスなどが映りません',
    implemented: false,
  },
  {
    id: 'webcodecs',
    label: 'C. 高速書き出し',
    description: '終局後の再生を、実際の時間より速く MP4 に書き出します',
    implemented: false,
  },
];

/** Bounds for how many moves the gauge shown to spectators lags behind games a person plays in. */
export const LIVE_DELAY_MIN = 1;
export const LIVE_DELAY_MAX = 10;

export interface AppSettings {
  /** Moves the spectators' gauge lags behind in games with a person playing (engine-only games have no delay). */
  liveDelayMoves: number;
  recordingMethod: RecordingMethod;
}

export const DEFAULT_SETTINGS: AppSettings = { liveDelayMoves: 3, recordingMethod: 'tab' };

export type Role = 'user' | 'staff' | 'admin';

/** Operators who may open the recording mode. */
export const canBroadcast = (role: Role | undefined) => role === 'staff' || role === 'admin';

/** The engine's estimate for the position after `moveNumber` moves. */
export interface GaugeEval {
  moveNumber: number;
  /** Black's chance of winning, 0..1. */
  winrateBlack: number;
}

/** What a spectator may see of a live game's evaluation. */
export interface GaugeState {
  gameId: string;
  /** Moves the visible evaluations lag behind the game. 0 once the game is over. */
  delay: number;
  /** Visible evaluations, oldest first. */
  evals: GaugeEval[];
  /** Id of the evaluator, e.g. "builtin" (a quick, rough estimate). */
  engine: string;
  final: boolean;
}
