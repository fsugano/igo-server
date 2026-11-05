import type { GaugeEval, GaugeState } from '@igo/shared';
import { useEffect, useRef, useState } from 'react';
import { call, getSocket } from '../socket';

/** Subscribes to a live game's evaluation gauge (spectators only; the server refuses players). */
export function useGauge(gameId: string, enabled: boolean): { gauge: GaugeState | null; error: string } {
  const [gauge, setGauge] = useState<GaugeState | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setGauge(null);
    setError('');
    if (!enabled) return;
    const s = getSocket();
    const watch = () =>
      void call<{ gauge: GaugeState }>('gauge:watch', gameId).then((r) => {
        if (r.ok) setGauge(r.gauge);
        else setError(r.error);
      });
    const onUpdate = (g: GaugeState) => {
      if (g.gameId === gameId) setGauge(g);
    };
    watch();
    s.on('connect', watch);
    s.on('gauge:update', onUpdate);
    return () => {
      s.off('connect', watch);
      s.off('gauge:update', onUpdate);
      s.emit('gauge:unwatch', gameId);
    };
  }, [gameId, enabled]);

  return { gauge, error };
}

/** A swing at least this large (in black's win rate) gets the big effect. */
const BIG_SWING = 0.15;

/**
 * Tug-of-war bar: black fills from the left, white from the right, meeting at black's win rate.
 * When a side loses ground, the lost part lingers in a lighter colour and then drains away.
 */
export function Gauge({ gauge, large = false }: { gauge: GaugeState | null; large?: boolean }) {
  const latest: GaugeEval | undefined = gauge?.evals.at(-1);
  const value = latest?.winrateBlack ?? 0.5;
  const [trail, setTrail] = useState(value);
  const [flash, setFlash] = useState<{ text: string; key: number } | null>(null);
  const prev = useRef<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setTrail(value), 650);
    const before = prev.current;
    if (before !== null && latest && Math.abs(value - before) >= BIG_SWING) {
      const reversed = (before - 0.5) * (value - 0.5) < 0;
      setFlash({ text: reversed ? '形勢逆転！' : '大きな一手', key: latest.moveNumber });
    }
    if (latest) prev.current = value;
    return () => clearTimeout(t);
  }, [value, latest]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const blackLost = Math.max(0, trail - value);
  const whiteLost = Math.max(0, value - trail);
  const b = Math.round(value * 100);

  return (
    <div className={`gauge${large ? ' large' : ''}${flash ? ' swing' : ''}`}>
      <div className="gauge-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={b} aria-label="黒の勝率">
        <div className="gauge-fill white" />
        <div className="gauge-fill black" style={{ width: pct(value) }} />
        {/* Drawn over the fills: the ground a side just lost, which drains away shortly after. */}
        <div className="gauge-trail" style={{ left: pct(value), width: pct(blackLost) }} />
        <div className="gauge-trail" style={{ left: pct(trail), width: pct(whiteLost) }} />
        <div className="gauge-mid" />
        {flash && (
          <div className="gauge-flash" key={flash.key}>
            {flash.text}
          </div>
        )}
      </div>
      <div className="gauge-labels">
        <span>黒 {latest ? `${b}%` : '—'}</span>
        <span className="gauge-note">
          {!gauge || !latest
            ? '形勢を計算中…'
            : gauge.final
              ? '終局時点の形勢'
              : gauge.delay > 0
                ? `形勢は${gauge.delay}手前の局面（${latest.moveNumber}手目）`
                : `${latest.moveNumber}手目の形勢`}
          {gauge?.engine === 'builtin' && ' · 速い解析'}
        </span>
        <span>白 {latest ? `${100 - b}%` : '—'}</span>
      </div>
    </div>
  );
}

/** Black's win rate over the game as a small line chart (50% in the middle). */
export function GaugeGraph({ evals, total }: { evals: GaugeEval[]; total: number }) {
  const w = 300;
  const h = 90;
  const n = Math.max(total, evals.at(-1)?.moveNumber ?? 0, 1);
  const pts = evals.map((e) => `${((e.moveNumber / n) * w).toFixed(1)},${((1 - e.winrateBlack) * h).toFixed(1)}`).join(' ');
  return (
    <svg className="gauge-graph" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="形勢の推移">
      <line x1={0} y1={h / 2} x2={w} y2={h / 2} className="mid" />
      {evals.length > 1 && <polyline points={pts} />}
    </svg>
  );
}
