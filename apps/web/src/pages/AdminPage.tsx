import { AppSettings, LIVE_DELAY_MAX, LIVE_DELAY_MIN, LobbyState, canBroadcast } from '@igo/shared';
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminSettings, api, errorText } from '../api';
import { useAuth } from '../auth';
import { call, getSocket } from '../socket';

/** Operators' menu: settings (admins change them, staff can read them) and live games to record. */
export function AdminPage() {
  const { account, loading } = useAuth();
  if (loading) return <p className="empty">読み込み中…</p>;
  if (!canBroadcast(account?.role)) return <p className="empty">このページは運営だけが使えます</p>;
  return (
    <div className="admin">
      <SettingsCard canEdit={account?.role === 'admin'} />
      <LiveGames />
    </div>
  );
}

function SettingsCard({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<AdminSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.adminSettings().then(
      (d) => {
        setData(d);
        setDraft(d.settings);
      },
      (e) => setError(errorText(e.message)),
    );
  }, []);

  if (error && !data) return <p className="error">{error}</p>;
  if (!data || !draft) return <p className="empty">読み込み中…</p>;

  const changed = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMessage('');
    setError('');
    try {
      const d = await api.saveAdminSettings(draft);
      setData(d);
      setDraft(d.settings);
      setMessage('保存しました。観戦中の画面にもすぐ反映されます');
    } catch (err) {
      setError(errorText((err as Error).message));
    }
  };

  return (
    <form className="card form" onSubmit={save}>
      <h2>運営設定</h2>
      {!canEdit && <p className="notice">収録担当の権限では見るだけです。変更は管理者が行います</p>}

      <fieldset disabled={!canEdit}>
        <legend>形勢ゲージ：観戦者への遅れ</legend>
        <label className="inline">
          <input
            type="number"
            min={LIVE_DELAY_MIN}
            max={LIVE_DELAY_MAX}
            step={1}
            value={draft.liveDelayMoves}
            onChange={(e) => setDraft({ ...draft, liveDelayMoves: Number(e.target.value) })}
          />
          手遅れで表示
        </label>
        <small>
          人が打つ対局で、観戦者に見せる形勢を何手前の局面にするか（{LIVE_DELAY_MIN}〜{LIVE_DELAY_MAX}手）。小さいほど臨場感が出ますが、
          対局者が別の端末で観戦画面を開いたときに助言として使われやすくなります。対局者本人には常に表示されません。AI 同士の対局は遅れなしです。
        </small>
      </fieldset>

      <fieldset disabled={!canEdit}>
        <legend>収録の方式</legend>
        {data.recordingMethods.map((m) => (
          <label key={m.id} className={`check method${m.implemented ? '' : ' unavailable'}`}>
            <input
              type="radio"
              name="recordingMethod"
              value={m.id}
              checked={draft.recordingMethod === m.id}
              disabled={!m.implemented}
              onChange={() => setDraft({ ...draft, recordingMethod: m.id })}
            />
            <span>
              <b>{m.label}</b>
              {!m.implemented && <span className="badge muted">準備中</span>}
              <small>{m.description}</small>
            </span>
          </label>
        ))}
      </fieldset>

      {canEdit && (
        <div className="buttons">
          <button className="primary" disabled={!changed}>
            保存
          </button>
          {changed && (
            <button type="button" onClick={() => setDraft(data.settings)}>
              元に戻す
            </button>
          )}
        </div>
      )}
      {message && <p className="up">{message}</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function LiveGames() {
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  useEffect(() => {
    const s = getSocket();
    const join = () =>
      void call<{ lobby: LobbyState }>('lobby:join').then((r) => {
        if (r.ok) setLobby(r.lobby);
      });
    join();
    s.on('connect', join);
    s.on('lobby:state', setLobby);
    return () => {
      s.off('connect', join);
      s.off('lobby:state', setLobby);
      s.emit('lobby:leave');
    };
  }, []);

  const games = lobby?.games.filter((g) => g.status === 'active') ?? [];
  return (
    <div className="card">
      <h2>収録できる対局</h2>
      <p className="meta">
        収録モードは 16:9 の動画用の画面です。対局者が「動画での公開」を許可していない場合、名前は「黒」「白」と表示されます。
      </p>
      {games.length === 0 && <p className="empty">対局中の碁はありません</p>}
      <ul className="games">
        {games.map((g) => (
          <li key={g.id}>
            <span>
              {g.black.username} vs {g.white.username}
            </span>
            <small>
              {g.size}路 · {g.moveCount}手 · <Link to={`/admin/broadcast/${g.id}`}>収録モードで開く</Link>
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}
