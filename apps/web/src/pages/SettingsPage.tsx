import { DECLARABLE_RANKS, DISPLAY_NAME_MAX, checkDisplayName, declaredRankLabel, gamesForLevel } from '@igo/shared';
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MyProfile, api, errorText } from '../api';
import { useAuth } from '../auth';
import { Avatar, LevelBadge } from '../components/UserBits';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_BYTES = 5 * 1024 * 1024;

/** Nickname, declared rank and picture (F-PRF-01). */
export function SettingsPage() {
  const { user, updateUser } = useAuth();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [name, setName] = useState('');
  const [rank, setRank] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    void api.myProfile().then((r) => {
      setProfile(r.profile);
      setName(r.profile.displayName ?? '');
      setRank(r.profile.declaredRank ?? '');
    });
  }, [user?.id]);

  if (!user) {
    return (
      <p className="empty">
        <Link to="/login">ログイン</Link>してください。
      </p>
    );
  }
  if (!profile) return <p className="empty">読み込み中…</p>;

  const apply = (r: { user: typeof user; profile?: MyProfile }) => {
    if (r.profile) setProfile(r.profile);
    if (r.user) updateUser(r.user);
  };

  const run = async (fn: () => Promise<void>, done: string) => {
    setError('');
    setSaved('');
    setBusy(true);
    try {
      await fn();
      setSaved(done);
    } catch (e) {
      setError(errorText((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const saveName = (e: FormEvent) => {
    e.preventDefault();
    const c = checkDisplayName(name);
    if ('error' in c) return setError(errorText(c.error));
    void run(async () => {
      const r = await api.saveProfile({ displayName: c.name });
      apply(r);
      setName(r.profile.displayName ?? '');
    }, 'ニックネームを変更しました');
  };

  const saveRank = (e: FormEvent) => {
    e.preventDefault();
    const warn = profile.rankResetsRating
      ? ''
      : 'レーティング対局を5局以上打っているので、表示だけが変わり、レーティングは変わりません。';
    void run(async () => apply(await api.saveProfile({ declaredRank: rank })), `申告棋力を変更しました。${warn}`);
  };

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > MAX_BYTES) return setError(errorText('image_too_large'));
    void run(async () => apply(await api.uploadAvatar(f)), '画像を変更しました');
  };

  const nameLocked = profile.nameChangeAt !== null;
  const nextAt = profile.nextLevelAt;
  const prevAt = gamesForLevel(profile.level);
  const progress = Math.min(100, Math.round(((profile.gamesCompleted - prevAt) / Math.max(1, nextAt - prevAt)) * 100));

  return (
    <div className="card settings">
      <h2>プロフィールの編集</h2>
      {error && <p className="error">{error}</p>}
      {saved && <p className="notice">{saved}</p>}

      <section>
        <h3>プロフィール画像</h3>
        <div className="avatar-edit">
          <Avatar u={user} size={96} />
          <div className="buttons">
            <button onClick={() => fileRef.current?.click()} disabled={busy}>
              画像を選ぶ
            </button>
            {user.avatarUrl && (
              <button className="danger" onClick={() => void run(async () => apply(await api.deleteAvatar()), '画像を削除しました')} disabled={busy}>
                削除
              </button>
            )}
            <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={pick} />
          </div>
        </div>
        <small className="meta">JPEG・PNG・WebP、5MBまで。正方形に切り抜いて保存します。撮影場所などの情報は削除されます。</small>
      </section>

      <section>
        <h3>ニックネーム</h3>
        <form className="form" onSubmit={saveName}>
          <label>
            ニックネーム（ログイン ID は @{user.username} のまま変わりません）
            <input value={name} maxLength={DISPLAY_NAME_MAX * 2} placeholder={user.username} onChange={(e) => setName(e.target.value)} disabled={nameLocked} />
          </label>
          <small>
            {nameLocked
              ? `次に変更できるのは ${new Date(profile.nameChangeAt!).toLocaleString('ja-JP')} 以降です。`
              : '1〜20文字。日本語も使えます。変更は1日1回までです。'}
          </small>
          <div className="buttons">
            <button className="primary" disabled={busy || nameLocked || !name.trim()}>
              変更する
            </button>
          </div>
        </form>
      </section>

      <section>
        <h3>棋力</h3>
        <p className="meta">
          公式棋力 <strong>{user.rank}</strong>（レーティング {user.rating}）
          {profile.declaredRank && ` · 申告棋力 ${declaredRankLabel(profile.declaredRank)}`}
        </p>
        <form className="form" onSubmit={saveRank}>
          <label>
            申告棋力
            <select value={rank} onChange={(e) => setRank(e.target.value)}>
              {!rank && <option value="">選んでください</option>}
              {DECLARABLE_RANKS.map((r) => (
                <option key={r} value={r}>
                  {declaredRankLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <small>
            {profile.rankResetsRating
              ? 'レーティング対局が5局になるまでは、変更するとレーティングもその棋力に合わせて設定し直します。'
              : 'レーティング対局を5局以上打っているので、変更しても表示だけが変わります（公式棋力は対局の結果で決まります）。'}
          </small>
          <div className="buttons">
            <button className="primary" disabled={busy || !rank || rank === profile.declaredRank}>
              変更する
            </button>
          </div>
        </form>
      </section>

      <section>
        <h3>
          ユーザーレベル <LevelBadge level={profile.level} />
        </h3>
        <div className="level-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <p className="meta">
          終局まで打った対局 {profile.gamesCompleted}局 · 次のレベルまであと {Math.max(0, nextAt - profile.gamesCompleted)}局
        </p>
        <small className="meta">
          レベルは強さではなく、どれだけ打ったかを表します。4手以上で終局した対局を数えます（AI との対局は1日10局、同じ相手とは1日5局まで）。
        </small>
      </section>
    </div>
  );
}
