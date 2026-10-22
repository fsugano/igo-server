import { ClockSettings, PlayerClock, displayClock } from '@igo/shared';

export function formatMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

export function Clock({
  settings,
  clock,
  elapsed,
  running,
}: {
  settings: ClockSettings;
  clock: PlayerClock;
  elapsed: number;
  running: boolean;
}) {
  const d = displayClock(settings, clock, running ? elapsed : 0);
  const low = d.period !== null ? d.period < 10_000 : d.main < 10_000 && settings.type === 'fischer';
  return (
    <div className={`clock${running ? ' running' : ''}${running && low ? ' low' : ''}`}>
      {d.period === null ? (
        <span className="main">{formatMs(d.main)}</span>
      ) : (
        <span className="main">
          秒読み {Math.ceil(d.period / 1000)}秒
        </span>
      )}
      {settings.type === 'byoyomi' && <span className="periods">残り{d.periods}回</span>}
    </div>
  );
}
