import { OPENING_LABELS, PlayStyle, PlayerRecord, STYLE_LABELS, WinLoss, winRate } from '@igo/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';

/** The record and playing style shown on a profile. */
export function PlayerStats({ username }: { username: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.stats>> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setData(null);
    setFailed(false);
    api.stats(username).then(setData, () => setFailed(true));
  }, [username]);

  if (failed) return <p className="error">戦績を読み込めませんでした</p>;
  if (!data) return <p className="meta">戦績を集計中…</p>;
  if (data.games === 0) return <p className="empty">終局した対局がまだないため、戦績はありません</p>;
  return (
    <div className="stats">
      <Record record={data.record} games={data.games} limit={data.limit} />
      <Style style={data.style} />
    </div>
  );
}

const pct = (r: WinLoss) => (r.games - r.draws > 0 ? `${Math.round(winRate(r) * 100)}%` : '—');
const wl = (r: WinLoss) => `${r.wins}勝${r.losses}敗${r.draws ? `${r.draws}分` : ''}`;

function Record({ record: r, games, limit }: { record: PlayerRecord; games: number; limit: number }) {
  const rows: [string, WinLoss][] = [
    ['黒番', r.asBlack],
    ['白番', r.asWhite],
    ['対人', r.vsHuman],
    ['対AI', r.vsBot],
    ['レート対局', r.rated],
    ...r.bySize.map((s): [string, WinLoss] => [`${s.size}路`, s.record]),
  ];
  return (
    <section className="stats-block">
      <h3>戦績</h3>
      <div className="stat-tiles">
        <div className="tile">
          <span className="label">通算</span>
          <span className="value">{wl(r.total)}</span>
          <span className="sub">勝率 {pct(r.total)}</span>
        </div>
        <div className="tile">
          <span className="label">{r.streak >= 0 ? '連勝中' : '連敗中'}</span>
          <span className="value">{Math.abs(r.streak)}</span>
          <span className="sub">最高 {r.bestWinStreak}連勝</span>
        </div>
        <div className="tile">
          <span className="label">平均手数</span>
          <span className="value">{r.averageMoves}</span>
          <span className="sub">手</span>
        </div>
      </div>
      <div className="recent-form" aria-label="直近の結果（左が新しい）">
        直近
        {r.recent.map((o, i) => (
          <span key={i} className={`form ${o}`}>
            {o === 'W' ? '勝' : o === 'L' ? '負' : '分'}
          </span>
        ))}
      </div>
      <table className="list compact">
        <thead>
          <tr>
            <th>区分</th>
            <th>局数</th>
            <th>勝敗</th>
            <th>勝率</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .filter(([, w]) => w.games > 0)
            .map(([label, w]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{w.games}</td>
                <td>{wl(w)}</td>
                <td>{pct(w)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <p className="meta">
        勝ち方：中押し {r.winsBy.resign} ・ 時間 {r.winsBy.time} ・ 目数 {r.winsBy.points}　／　負け方：中押し {r.lossesBy.resign} ・ 時間{' '}
        {r.lossesBy.time} ・ 目数 {r.lossesBy.points}
      </p>
      {r.opponents.length > 0 && (
        <p className="meta">
          よく打つ相手：
          {r.opponents.map((o) => `${o.name}（${wl(o.record)}）`).join('、')}
        </p>
      )}
      {r.ratingHistory.length > 1 && <RatingGraph points={r.ratingHistory} />}
      {games >= limit && <p className="meta">直近{limit}局から集計しています</p>}
    </section>
  );
}

function RatingGraph({ points }: { points: { at: number; rating: number }[] }) {
  const w = 600;
  const h = 120;
  const min = Math.min(...points.map((p) => p.rating));
  const max = Math.max(...points.map((p) => p.rating));
  const span = Math.max(max - min, 50);
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - 8 - ((p.rating - min) / span) * (h - 16)]);
  return (
    <figure className="rating-graph">
      <figcaption>
        レーティングの推移（{min}〜{max}）
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="レーティングの推移">
        <polyline points={xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} />
      </svg>
    </figure>
  );
}

const AXES: { key: keyof PlayStyle['scores']; left: string; right: string }[] = [
  { key: 'territory', left: '厚み', right: '実利' },
  { key: 'fighting', left: '穏やか', right: '戦い' },
  { key: 'center', left: '辺・隅', right: '中央' },
  { key: 'finishing', left: '目数勝ち', right: '中押し勝ち' },
];

function Style({ style: s }: { style: PlayStyle }) {
  return (
    <section className="stats-block">
      <h3>棋風</h3>
      {!s.ready ? (
        <p className="meta">棋風の判定には、あと{s.needGames}局（自分の手が10手以上の対局）が必要です</p>
      ) : (
        <>
          <p className="style-name">
            {STYLE_LABELS[s.style].name}
            <small>（直近{s.gamesAnalyzed}局から判定・目安）</small>
          </p>
          <p>{STYLE_LABELS[s.style].description}</p>
          <div className="style-axes">
            {AXES.map((a) => (
              <div key={a.key} className="axis">
                <span className="end">{a.left}</span>
                <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.scores[a.key]} aria-label={`${a.left}〜${a.right}`}>
                  <div className="mark" style={{ left: `${s.scores[a.key]}%` }} />
                </div>
                <span className="end">{a.right}</span>
              </div>
            ))}
          </div>
          {s.traits.length > 0 && (
            <ul className="traits">
              {s.traits.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          {s.openings.length > 0 && (
            <p className="meta">
              隅の打ち方（13路・19路）：
              {s.openings.map((o) => `${OPENING_LABELS[o.point]} ${o.count}`).join(' ・ ')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
