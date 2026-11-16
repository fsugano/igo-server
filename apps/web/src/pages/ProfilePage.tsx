import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { PlayerStats } from '../components/PlayerStats';
import { Avatar, LevelBadge } from '../components/UserBits';
import { useSocial } from '../social';
import { ReportDialog } from '../components/ReportDialog';
import { declaredRankLabel } from '@igo/shared';
import { resultText } from './GamePage';

export function ProfilePage() {
  const { username = '' } = useParams();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.profile>> | null>(null);
  const [missing, setMissing] = useState(false);
  const { user: me } = useAuth();
  const { following, setFollow, blocked, setBlock } = useSocial();
  const [reporting, setReporting] = useState<'user' | 'avatar' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    api.profile(username).then(setData, () => setMissing(true));
  }, [username]);

  if (missing) return <p className="empty">ユーザーが見つかりません</p>;
  if (!data) return <p className="empty">読み込み中…</p>;
  const { user, games, follows } = data;
  const isFollowing = following.has(user.id);
  const toggleFollow = async () => {
    setError('');
    const e = await setFollow(user.id, !isFollowing);
    if (e) return setError(errorText(e));
    // The follower count changed: count it here rather than fetching the profile again.
    setData({ ...data, follows: { ...follows, followers: follows.followers + (isFollowing ? -1 : 1) } });
  };
  const mine = me?.id === user.id;
  const finished = games.filter((g) => g.status === 'finished');
  const wins = finished.filter(
    (g) => (g.result?.startsWith('B+') && g.black === user.username) || (g.result?.startsWith('W+') && g.white === user.username),
  ).length;

  return (
    <div className="card">
      <div className="profile-head">
        <Avatar u={user} size={88} />
        <div>
          <h2>
            {user.displayName}
            {user.displayName !== user.username && <span className="handle"> @{user.username}</span>} <span className="rank">{user.rank}</span>
            {!user.bot && <LevelBadge level={user.level} />}
            {user.premium && <span className="badge">プレミアム</span>}
          </h2>
          <p className="meta">
            レーティング {user.rating} · レート対局 {user.gamesPlayed}局 · 直近{finished.length}局で{wins}勝
            {!user.bot && ` · 終局まで打った対局 ${data.gamesCompleted}局`}
            {data.declaredRank && declaredRankLabel(data.declaredRank) !== user.rank && ` · 申告棋力 ${declaredRankLabel(data.declaredRank)}`}
          </p>
          {mine && (
            <Link className="button" to="/settings/profile">
              プロフィールを編集
            </Link>
          )}
        </div>
      </div>
      {!user.bot && (
        <p className="meta">
          フォロー {follows.following} · フォロワー {follows.followers}
        </p>
      )}
      {me && !mine && !user.bot && (
        <div className="buttons">
          <button onClick={() => void toggleFollow()}>{isFollowing ? 'フォロー中' : 'フォローする'}</button>
          <Link className="button" to={`/messages/${user.id}`}>
            メッセージを送る
          </Link>
          <button
            className="link"
            onClick={() => {
              const block = !blocked.has(user.id);
              if (block && !window.confirm(`${user.displayName}さんをブロックしますか？ 対局の申し込みやメッセージが届かなくなります。`)) return;
              void setBlock(user.id, block).then((e) => e && setError(errorText(e)));
            }}
          >
            {blocked.has(user.id) ? 'ブロックを解除' : 'ブロックする'}
          </button>
          <button className="link danger" onClick={() => setReporting('user')}>
            通報する
          </button>
          {user.avatarUrl && (
            <button className="link danger" onClick={() => setReporting('avatar')}>
              画像を通報する
            </button>
          )}
        </div>
      )}
      {reporting && <ReportDialog type={reporting} id={user.id} onClose={() => setReporting(null)} />}
      {error && <p className="error">{error}</p>}
      {mine && <RecordingConsent />}
      <PlayerStats username={user.username} />
      <h3>対局履歴</h3>
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

/** Lets the user agree to appear by name in videos the operators publish. */
function RecordingConsent() {
  const { account, setAccount } = useAuth();
  const [error, setError] = useState('');
  if (!account) return null;
  const toggle = async (allow: boolean) => {
    setError('');
    try {
      setAccount((await api.setAllowRecording(allow)).account);
    } catch (e) {
      setError(errorText((e as Error).message));
    }
  };
  return (
    <div className="consent">
      <label className="check">
        <input type="checkbox" checked={account.allowRecording} onChange={(e) => void toggle(e.target.checked)} />
        自分の対局を、名前を出して動画（YouTube など）で公開してよい
      </label>
      <small>許可しない場合も、運営が公開する動画では名前が「黒」「白」と表示されます。いつでも変更できます。</small>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
