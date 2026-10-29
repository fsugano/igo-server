import type { AiEngineInfo, AiGameRequest, ClockSettings, LobbyState, Seek, SeekRequest } from '@igo/shared';
import { describeClock } from '@igo/shared';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { BotBadge } from '../components/BotBadge';
import { call, getSocket } from '../socket';

const CLOCK_PRESETS: { label: string; clock: ClockSettings }[] = [
  { label: '早碁 5分 + 30秒×3', clock: { type: 'byoyomi', mainTime: 5 * 60_000, periods: 3, periodTime: 30_000 } },
  { label: '10分 + 30秒×3', clock: { type: 'byoyomi', mainTime: 10 * 60_000, periods: 3, periodTime: 30_000 } },
  { label: '20分 + 30秒×3', clock: { type: 'byoyomi', mainTime: 20 * 60_000, periods: 3, periodTime: 30_000 } },
  { label: '40分 + 60秒×5', clock: { type: 'byoyomi', mainTime: 40 * 60_000, periods: 5, periodTime: 60_000 } },
  { label: '秒読みのみ 30秒×5', clock: { type: 'byoyomi', mainTime: 0, periods: 5, periodTime: 30_000 } },
  { label: 'フィッシャー 5分 + 10秒', clock: { type: 'fischer', mainTime: 5 * 60_000, increment: 10_000, maxTime: 10 * 60_000 } },
];

const sizeLabel = (n: number) => `${n}路`;
const rulesLabel = (r: string) => (r === 'japanese' ? '日本ルール' : '中国ルール');
const colorLabel = { black: '黒番', white: '白番', random: 'ニギリ' } as const;
/** Byo-yomi only: a game between engines then never waits on a long main time. */
const AI_VS_AI_PRESET = 4;

type Mode = 'human' | 'human-ai' | 'ai-ai';
const MODES: { mode: Mode; label: string }[] = [
  { mode: 'human', label: '人対人' },
  { mode: 'human-ai', label: '人対AI' },
  { mode: 'ai-ai', label: 'AI対AI' },
];

export function LobbyPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [error, setError] = useState('');

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

  const accept = async (seek: Seek) => {
    setError('');
    const r = await call<{ gameId: string }>('seek:accept', seek.id);
    if (r.ok) navigate(`/game/${r.gameId}`);
    else setError(errorText(r.error));
  };

  const cancel = async (seek: Seek) => {
    const r = await call('seek:cancel', seek.id);
    if (!r.ok) setError(errorText(r.error));
  };

  const myGame = lobby?.games.find((g) => user && (g.black.id === user.id || g.white.id === user.id));

  return (
    <div className="lobby">
      <section className="card">
        <h2>対局の申し込み</h2>
        {myGame && (
          <p className="notice">
            対局中の碁があります。<Link to={`/game/${myGame.id}`}>対局に戻る</Link>
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {!lobby ? (
          <p className="empty">読み込み中…</p>
        ) : lobby.seeks.length === 0 ? (
          <p className="empty">募集中の対局はありません。右のフォームから募集してみましょう。</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>募集者</th>
                <th>条件</th>
                <th>持ち時間</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lobby.seeks.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/u/${s.creator.username}`}>{s.creator.username}</Link>{' '}
                    <span className="rank">{s.creator.rank}</span>
                  </td>
                  <td>
                    {sizeLabel(s.size)} · {s.handicap ? `${s.handicap}子` : `コミ${s.komi}`} · {rulesLabel(s.ruleset)} ·{' '}
                    {s.rated ? 'レート' : '自由'} · 募集者{colorLabel[s.color]}
                  </td>
                  <td>{describeClock(s.clock)}</td>
                  <td className="actions">
                    {user?.id === s.creator.id ? (
                      <button onClick={() => void cancel(s)}>取り消す</button>
                    ) : (
                      <button className="primary" disabled={!user} onClick={() => void accept(s)}>
                        対局する
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <aside className="side">
        {user ? <NewGame onError={setError} /> : (
          <section className="card">
            <p>
              対局するには<Link to="/login">ログインまたは新規登録</Link>してください。観戦はログインなしでもできます。
            </p>
          </section>
        )}
        <section className="card">
          <h2>対局中 ({lobby?.games.length ?? 0})</h2>
          {lobby?.games.length ? (
            <ul className="games">
              {lobby.games.map((g) => (
                <li key={g.id}>
                  <Link to={`/game/${g.id}`}>
                    ● {g.black.username} <span className="rank">{g.black.rank}</span>
                    <BotBadge user={g.black} /> vs ○ {g.white.username} <span className="rank">{g.white.rank}</span>
                    <BotBadge user={g.white} />
                  </Link>
                  <small>
                    {sizeLabel(g.size)} · {g.moveCount}手
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">今は対局がありません</p>
          )}
        </section>
        <section className="card">
          <h2>オンライン ({lobby?.online.length ?? 0})</h2>
          <ul className="users">
            {lobby?.online.map((u) => (
              <li key={u.id}>
                <Link to={`/u/${u.username}`}>{u.username}</Link> <span className="rank">{u.rank}</span>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}

function NewGame({ onError }: { onError: (e: string) => void }) {
  const [mode, setMode] = useState<Mode>('human');
  return (
    <section className="card">
      <h2>対局を始める</h2>
      <div className="tabs">
        {MODES.map((m) => (
          <button key={m.mode} className={mode === m.mode ? 'active' : ''} onClick={() => setMode(m.mode)}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'human' ? <SeekForm onError={onError} /> : <AiForm key={mode} mode={mode} onError={onError} />}
    </section>
  );
}

function AiForm({ mode, onError }: { mode: 'human-ai' | 'ai-ai'; onError: (e: string) => void }) {
  const navigate = useNavigate();
  const [engines, setEngines] = useState<AiEngineInfo[]>([]);
  const [size, setSize] = useState<9 | 13 | 19>(9);
  const [preset, setPreset] = useState(mode === 'ai-ai' ? AI_VS_AI_PRESET : 1);
  const [handicap, setHandicap] = useState(0);
  const [komi, setKomi] = useState(6.5);
  const [ruleset, setRuleset] = useState<'japanese' | 'chinese'>('japanese');
  const [color, setColor] = useState<SeekRequest['color']>('black');
  const [engine, setEngine] = useState('');
  const [whiteEngine, setWhiteEngine] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call<{ engines: AiEngineInfo[] }>('ai:engines').then((r) => {
      if (!r.ok) return onError(errorText(r.error));
      setEngines(r.engines);
      const first = r.engines[0]?.id ?? '';
      const second = r.engines[1]?.id ?? first;
      // Between two engines, default to Lv2: Lv1 is meant for beginners to play against.
      setEngine(mode === 'ai-ai' ? second : first);
      setWhiteEngine(second);
    });
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    onError('');
    let black: string | null;
    let white: string | null;
    if (mode === 'ai-ai') {
      black = engine;
      white = whiteEngine;
    } else {
      // With handicap stones the person takes black unless they chose white.
      const meBlack = color === 'black' || (color === 'random' && (handicap > 0 || Math.random() < 0.5));
      black = meBlack ? null : engine;
      white = meBlack ? engine : null;
    }
    const req: AiGameRequest = {
      size,
      komi: handicap ? 0.5 : komi,
      handicap,
      ruleset,
      clock: CLOCK_PRESETS[preset].clock,
      black,
      white,
    };
    setBusy(true);
    const r = await call<{ gameId: string }>('ai:start', req);
    setBusy(false);
    if (r.ok) navigate(`/game/${r.gameId}`);
    else onError(errorText(r.error));
  };

  const engineSelect = (value: string, set: (v: string) => void) => (
    <select value={value} onChange={(e) => set(e.target.value)}>
      {engines.map((e) => (
        <option key={e.id} value={e.id}>
          {e.label}
        </option>
      ))}
    </select>
  );

  return (
    <form className="form" onSubmit={submit}>
      {mode === 'human-ai' ? (
        <div className="row">
          <label>
            AIの強さ
            {engineSelect(engine, setEngine)}
          </label>
          <label>
            自分の手番
            <select value={color} onChange={(e) => setColor(e.target.value as SeekRequest['color'])}>
              <option value="black">黒</option>
              <option value="white">白</option>
              <option value="random">ニギリ</option>
            </select>
          </label>
        </div>
      ) : (
        <div className="row">
          <label>
            黒番のAI
            {engineSelect(engine, setEngine)}
          </label>
          <label>
            白番のAI
            {engineSelect(whiteEngine, setWhiteEngine)}
          </label>
        </div>
      )}
      <div className="row">
        <label>
          碁盤
          <select value={size} onChange={(e) => setSize(Number(e.target.value) as 9 | 13 | 19)}>
            <option value={9}>9路</option>
            <option value={13}>13路</option>
            <option value={19}>19路</option>
          </select>
        </label>
        <label>
          ルール
          <select value={ruleset} onChange={(e) => setRuleset(e.target.value as 'japanese' | 'chinese')}>
            <option value="japanese">日本ルール</option>
            <option value="chinese">中国ルール</option>
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
      </div>
      <small>
        {mode === 'human-ai'
          ? 'AIとの対局はレーティングに影響しません。'
          : 'AI同士の対局を観戦できます。対局はロビーの「対局中」から誰でも見られます。'}
      </small>
      <button className="primary" disabled={busy || !engines.length}>
        {mode === 'human-ai' ? 'AIと対局する' : '観戦を始める'}
      </button>
    </form>
  );
}

function SeekForm({ onError }: { onError: (e: string) => void }) {
  const [size, setSize] = useState<9 | 13 | 19>(19);
  const [preset, setPreset] = useState(1);
  const [handicap, setHandicap] = useState(0);
  const [komi, setKomi] = useState(6.5);
  const [ruleset, setRuleset] = useState<'japanese' | 'chinese'>('japanese');
  const [rated, setRated] = useState(true);
  const [color, setColor] = useState<SeekRequest['color']>('random');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    onError('');
    const req: SeekRequest = {
      size,
      komi: handicap ? 0.5 : komi,
      handicap,
      ruleset,
      clock: CLOCK_PRESETS[preset].clock,
      rated,
      color: handicap ? color === 'random' ? 'black' : color : color,
    };
    const r = await call('seek:create', req);
    if (!r.ok) onError(errorText(r.error));
  };

  return (
    <form className="form" onSubmit={submit}>
      <label>
        碁盤
        <select value={size} onChange={(e) => setSize(Number(e.target.value) as 9 | 13 | 19)}>
          <option value={19}>19路</option>
          <option value={13}>13路</option>
          <option value={9}>9路</option>
        </select>
      </label>
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
      </div>
      <div className="row">
        <label>
          ルール
          <select value={ruleset} onChange={(e) => setRuleset(e.target.value as 'japanese' | 'chinese')}>
            <option value="japanese">日本ルール</option>
            <option value="chinese">中国ルール</option>
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
      <label className="check">
        <input type="checkbox" checked={rated} onChange={(e) => setRated(e.target.checked)} />
        レーティング対局
      </label>
      <button className="primary">募集する</button>
    </form>
  );
}
