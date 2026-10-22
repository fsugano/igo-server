import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ProfileGame, api } from '../api';
import { resultText } from './GamePage';
import type { PublicUser } from '@igo/shared';

export function ProfilePage() {
  const { username = '' } = useParams();
  const [data, setData] = useState<{ user: PublicUser; games: ProfileGame[] } | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setData(null);
    api.profile(username).then(setData, () => setMissing(true));
  }, [username]);

  if (missing) return <p className="empty">ユーザーが見つかりません</p>;
  if (!data) return <p className="empty">読み込み中…</p>;
  const { user, games } = data;
  const finished = games.filter((g) => g.status === 'finished');
  const wins = finished.filter(
    (g) => (g.result?.startsWith('B+') && g.black === user.username) || (g.result?.startsWith('W+') && g.white === user.username),
  ).length;

  return (
    <div className="card">
      <h2>
        {user.username} <span className="rank">{user.rank}</span>
        {user.premium && <span className="badge">プレミアム</span>}
      </h2>
      <p className="meta">
        レーティング {user.rating} · レート対局 {user.gamesPlayed}局 · 直近{finished.length}局で{wins}勝
      </p>
      <table className="list">
        <thead>
          <tr>
            <th>日時</th>
            <th>黒</th>
            <th>白</th>
            <th>結果</th>
            <th>手数</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <tr key={g.id}>
              <td>
                <Link to={`/game/${g.id}`}>{new Date(g.startedAt).toLocaleString('ja-JP')}</Link>
              </td>
              <td>{g.black}</td>
              <td>{g.white}</td>
              <td>{g.status === 'active' ? '対局中' : resultText(g.result)}</td>
              <td>
                {g.moveCount} · {g.size}路
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {games.length === 0 && <p className="empty">まだ対局がありません</p>}
    </div>
  );
}
