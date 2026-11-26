import type { ClockSettings, SeekRequest } from '@igo/shared';
import { describeClock } from '@igo/shared';
import { FormEvent, useState } from 'react';

export const CLOCK_PRESETS: { label: string; clock: ClockSettings }[] = [
  { label: '早碁 5分 + 30秒×3', clock: { type: 'byoyomi', mainTime: 5 * 60_000, periods: 3, periodTime: 30_000 } },
  { label: '10分 + 30秒×3', clock: { type: 'byoyomi', mainTime: 10 * 60_000, periods: 3, periodTime: 30_000 } },
  { label: '20分 + 30秒×3', clock: { type: 'byoyomi', mainTime: 20 * 60_000, periods: 3, periodTime: 30_000 } },
  { label: '40分 + 60秒×5', clock: { type: 'byoyomi', mainTime: 40 * 60_000, periods: 5, periodTime: 60_000 } },
  { label: '秒読みのみ 30秒×5', clock: { type: 'byoyomi', mainTime: 0, periods: 5, periodTime: 30_000 } },
  { label: 'フィッシャー 5分 + 10秒', clock: { type: 'fischer', mainTime: 5 * 60_000, increment: 10_000, maxTime: 10 * 60_000 } },
];

export const sizeLabel = (n: number) => `${n}路`;
export const rulesLabel = (r: string) => (r === 'japanese' ? '日本ルール' : '中国ルール');
export const colorLabel = { black: '黒番', white: '白番', random: 'ニギリ' } as const;

/** The colour seen from the other side of an offer. */
export const otherColor = (c: SeekRequest['color']): SeekRequest['color'] => (c === 'black' ? 'white' : c === 'white' ? 'black' : 'random');

/** One line of conditions, e.g. "19路 · コミ6.5 · 日本ルール · レート". */
export const describeConditions = (r: SeekRequest) =>
  `${sizeLabel(r.size)} · ${r.handicap ? `${r.handicap}子` : `コミ${r.komi}`} · ${rulesLabel(r.ruleset)} · ${r.rated ? 'レート' : '自由'} · ${describeClock(r.clock)}`;

function presetOf(clock: ClockSettings | undefined) {
  if (!clock) return 1;
  const i = CLOCK_PRESETS.findIndex((p) => JSON.stringify(p.clock) === JSON.stringify(clock));
  return i < 0 ? 1 : i;
}

/** Conditions for a game between people: used for open seeks, challenges and counter-offers. `color` is the submitter's. */
export function GameForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: SeekRequest;
  submitLabel: string;
  onSubmit: (req: SeekRequest) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [size, setSize] = useState<9 | 13 | 19>(initial?.size ?? 19);
  const [preset, setPreset] = useState(presetOf(initial?.clock));
  const [handicap, setHandicap] = useState(initial?.handicap ?? 0);
  const [komi, setKomi] = useState(initial && !initial.handicap ? initial.komi : 6.5);
  const [ruleset, setRuleset] = useState<'japanese' | 'chinese'>(initial?.ruleset ?? 'japanese');
  const [rated, setRated] = useState(initial?.rated ?? true);
  const [color, setColor] = useState<SeekRequest['color']>(initial?.color ?? 'random');
  const [sending, setSending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      await onSubmit({
        size,
        komi: handicap ? 0.5 : komi,
        handicap,
        ruleset,
        clock: CLOCK_PRESETS[preset].clock,
        rated,
        color: handicap && color === 'random' ? 'black' : color,
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <div className="row">
        <label>
          碁盤
          <select value={size} onChange={(e) => setSize(Number(e.target.value) as 9 | 13 | 19)}>
            <option value={19}>19路</option>
            <option value={13}>13路</option>
            <option value={9}>9路</option>
          </select>
        </label>
        <label>
          自分の手番
          <select value={color} onChange={(e) => setColor(e.target.value as SeekRequest['color'])}>
            <option value="random">ニギリ</option>
            <option value="black">黒</option>
            <option value="white">白</option>
          </select>
        </label>
      </div>
      <label>
        持ち時間
        <select value={preset} onChange={(e) => setPreset(Number(e.target.value))}>
          {CLOCK_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <label>
          置き石
          <select value={handicap} onChange={(e) => setHandicap(Number(e.target.value))}>
            <option value={0}>互先</option>
            {[2, 3, 4, 5, 6, 7, 8, 9].filter((h) => size === 19 || h <= 5).map((h) => (
              <option key={h} value={h}>
                {h}子
              </option>
            ))}
          </select>
        </label>
        <label>
          コミ
          <input
            type="number"
            step={0.5}
            value={handicap ? 0.5 : komi}
            disabled={handicap > 0}
            onChange={(e) => setKomi(Number(e.target.value))}
          />
        </label>
        <label>
          ルール
          <select value={ruleset} onChange={(e) => setRuleset(e.target.value as 'japanese' | 'chinese')}>
            <option value="japanese">日本</option>
            <option value="chinese">中国</option>
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={rated} onChange={(e) => setRated(e.target.checked)} />
        レーティング対局
      </label>
      <div className="buttons">
        {onCancel && (
          <button type="button" onClick={onCancel}>
            戻る
          </button>
        )}
        <button className="primary" disabled={sending}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
