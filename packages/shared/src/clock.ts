export type ClockSettings =
  | { type: 'byoyomi'; mainTime: number; periods: number; periodTime: number }
  | { type: 'fischer'; mainTime: number; increment: number; maxTime: number };

/** Per-player clock state. All times in milliseconds. */
export interface PlayerClock {
  main: number;
  periods: number;
}

export function initialClock(s: ClockSettings): PlayerClock {
  return { main: s.mainTime, periods: s.type === 'byoyomi' ? s.periods : 0 };
}

/** Milliseconds the player can still think on this turn before flagging. */
export function timeUntilFlag(s: ClockSettings, c: PlayerClock): number {
  if (s.type === 'byoyomi') return c.main + c.periods * s.periodTime;
  return c.main;
}

/** Charges `elapsed` ms for a completed move. */
export function chargeMove(
  s: ClockSettings,
  c: PlayerClock,
  elapsed: number,
): { clock: PlayerClock; timedOut: boolean } {
  if (elapsed >= timeUntilFlag(s, c)) return { clock: { main: 0, periods: 0 }, timedOut: true };
  if (s.type === 'fischer') {
    return { clock: { main: Math.min(c.main - elapsed + s.increment, s.maxTime), periods: 0 }, timedOut: false };
  }
  if (elapsed <= c.main) return { clock: { main: c.main - elapsed, periods: c.periods }, timedOut: false };
  const overflow = elapsed - c.main;
  return { clock: { main: 0, periods: c.periods - Math.floor(overflow / s.periodTime) }, timedOut: false };
}

export interface ClockDisplay {
  main: number;
  periods: number;
  /** Time left in the current byo-yomi period, when in byo-yomi. */
  period: number | null;
}

/** What to show for a clock that has been running for `elapsed` ms this turn. */
export function displayClock(s: ClockSettings, c: PlayerClock, elapsed: number): ClockDisplay {
  if (s.type === 'fischer') return { main: Math.max(0, c.main - elapsed), periods: 0, period: null };
  if (elapsed < c.main) return { main: c.main - elapsed, periods: c.periods, period: null };
  const overflow = elapsed - c.main;
  const used = Math.floor(overflow / s.periodTime);
  const periods = Math.max(0, c.periods - used);
  return { main: 0, periods, period: periods === 0 ? 0 : s.periodTime - (overflow % s.periodTime) };
}

export function describeClock(s: ClockSettings): string {
  const min = (ms: number) => `${Math.round(ms / 60000)}分`;
  if (s.type === 'byoyomi') return `${min(s.mainTime)} + ${s.periodTime / 1000}秒×${s.periods}`;
  return `${min(s.mainTime)} + ${s.increment / 1000}秒加算`;
}
