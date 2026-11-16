import type { AiEngineInfo, AiGameRequest, LobbyChatMessage, LobbyState, OnlineUser, PresenceStatus, Seek, SeekRequest } from '@igo/shared';
import { describeClock } from '@igo/shared';
import { FormEvent, forwardRef, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { BotBadge } from '../components/BotBadge';
import { CLOCK_PRESETS, GameForm, colorLabel, rulesLabel, sizeLabel } from '../components/GameForm';
import { Modal } from '../components/Modal';
import { call, getSocket } from '../socket';

/** Byo-yomi only: a game between engines then never waits on a long main time. */
const AI_VS_AI_PRESET = 4;

type Mode = 'human' | 'human-ai' | 'ai-ai';
const MODES: { mode: Mode; label: string }[] = [
  { mode: 'human', label: '人対人' },
  { mode: 'human-ai', label: '人対AI' },
  { mode: 'ai-ai', label: 'AI対AI' },
];

type Tab = 'online' | 'seeks' | 'games';
const STATUS_LABEL: Record<PresenceStatus, string> = {
  available: '対局できます',
  playing: '対局中',
  playing_ai: 'AIと対局中',
  busy: '取り込み中',
};
const MAX_CHAT = 200;

export function LobbyPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [chat, setChat] = useState<LobbyChatMessage[]>([]);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('online');
  const [mode, setMode] = useState<Mode>('human');
  const [sheet, setSheet] = useState<OnlineUser | null>(null);
  const newGameRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const s = getSocket();
    const join = () =>
      void call<{ lobby: LobbyState; chat: LobbyChatMessage[] }>('lobby:join').then((r) => {
        if (!r.ok) return;
        setLobby(r.lobby);
        setChat(r.chat);
      });
    const onChat = (m: LobbyChatMessage) => setChat((c) => [...c.slice(-(MAX_CHAT - 1)), m]);
    join();
    s.on('connect', join);
    s.on('lobby:state', setLobby);
    s.on('lobbychat:message', onChat);
    return () => {
      s.off('connect', join);
      s.off('lobby:state', setLobby);
      s.off('lobbychat:message', onChat);
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

  const playAi = () => {
    setMode('human-ai');
    newGameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const myGame = lobby?.games.find((g) => user && (g.black.id === user.id || g.white.id === user.id));
  const me = lobby?.online.find((u) => u.id === user?.id);
  // Keep the open sheet in step with the list (status changes, going offline).
  const sheetUser = sheet && (lobby?.online.find((u) => u.id === sheet.id) ?? { ...sheet, status: 'busy' as const, offline: true });

  return (
    <div className="lobby">
      <section className="card">
        <div className="tabs lobby-tabs" role="tablist">
          {(
            [
              ['online', `オンライン (${lobby?.online.length ?? 0})`],
              ['seeks', `募集 (${lobby?.seeks.length ?? 0})`],
              ['games', `対局中 (${lobby?.games.length ?? 0})`],
            ] as const
          ).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
        {myGame && (
          <p className="notice">
            対局中の碁があります。<Link to={`/game/${myGame.id}`}>対局に戻る</Link>
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {!lobby ? (
          <p className="empty">読み込み中…</p>
        ) : tab === 'online' ? (
          <OnlineList lobby={lobby} me={me} onOpen={setSheet} onPlayAi={playAi} onError={setError} />
        ) : tab === 'seeks' ? (
          <SeekList lobby={lobby} onAccept={accept} onCancel={cancel} />
        ) : (
          <GameList lobby={lobby} />
        )}
      </section>

      <aside className="side">
        {user ? (
          <NewGame ref={newGameRef} mode={mode} setMode={setMode} onError={setError} />
        ) : (
          <section className="card">
            <p>
              対局するには<Link to="/login">ログインまたは新規登録</Link>してください。観戦はログインなしでもできます。
            </p>
          </section>
        )}
        <LobbyChat messages={chat} />
      </aside>

      {sheetUser && <UserSheet u={sheetUser} offline={'offline' in sheetUser} onClose={() => setSheet(null)} />}
    </div>
  );
}

const initial = (name: string) => name.slice(0, 1).toUpperCase();

function OnlineList({
  lobby,
  me,
  onOpen,
  onPlayAi,
  onError,
}: {
  lobby: LobbyState;
  me: OnlineUser | undefined;
  onOpen: (u: OnlineUser) => void;
  onPlayAi: () => void;
  onError: (e: string) => void;
}) {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const q = query.trim().toLowerCase();
  const people = lobby.online.filter(
    (u) => (!q || u.username.toLowerCase().includes(q)) && (!onlyAvailable || u.status === 'available'),
  );

  const setBusy = async (busy: boolean) => {
    const r = await call('presence:setStatus', busy ? 'busy' : 'available');
    if (!r.ok) onError(errorText(r.error));
  };

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="名前で探す" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="名前で探す" />
        <label className="check">
          <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} />
          対局できる人だけ
        </label>
        {me && (me.status === 'available' || me.status === 'busy') && (
          <label className="check" title="オフにすると、ほかの人から対局を申し込まれなくなります">
            <input type="checkbox" checked={me.status === 'available'} onChange={(e) => void setBusy(!e.target.checked)} />
            申し込みを受け付ける
          </label>
        )}
      </div>
      <ul className="people">
        {user && (
          <li>
            <button className="person ai" onClick={onPlayAi}>
              <span className="avatar">AI</span>
              <span className="who">
                <strong>AIと打つ</strong>
                <small>いつでも対局できます</small>
              </span>
              <span className="presence available">対局できます</span>
            </button>
          </li>
        )}
        {people.map((u) => (
          <li key={u.id}>
            <button className={`person${u.id === user?.id ? ' me' : ''}`} onClick={() => onOpen(u)}>
              <span className="avatar">{initial(u.username)}</span>
              <span className="who">
                <strong>{u.username}</strong>
                <small>
                  {u.rank} · {u.rating}
                  {u.id === user?.id && ' · あなた'}
                </small>
              </span>
              <span className={`presence ${u.status}`}>{STATUS_LABEL[u.status]}</span>
            </button>
          </li>
        ))}
      </ul>
      {!people.length && <p className="empty">{q || onlyAvailable ? '条件に合う人はいません' : 'オンラインの人はいません'}</p>}
    </>
  );
}

function UserSheet({ u, offline, onClose }: { u: OnlineUser; offline: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const isMe = u.id === user?.id;
  const canAsk = !!user && !isMe && !offline && u.status === 'available';

  const challenge = async (req: SeekRequest) => {
    setError('');
    const r = await call('challenge:create', u.id, req);
    if (r.ok) onClose();
    else setError(errorText(r.error));
  };

  return (
    <Modal title={u.username} onClose={onClose}>
      <div className="sheet-head">
        <span className="avatar large">{initial(u.username)}</span>
        <div>
          <div>
            <strong>{u.username}</strong> <span className="rank">{u.rank}</span>
          </div>
          <small className="meta">
            レーティング {u.rating} · {u.gamesPlayed}局
          </small>
          <div>
            <span className={`presence ${u.status}`}>{offline ? 'オフライン' : STATUS_LABEL[u.status]}</span>
          </div>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {asking ? (
        <GameForm submitLabel="申し込む" onSubmit={challenge} onCancel={() => setAsking(false)} />
      ) : (
        <div className="buttons stack">
          {!isMe && (
            <button className="primary" disabled={!canAsk} onClick={() => setAsking(true)}>
              対局を申し込む
            </button>
          )}
          {!user && <small className="meta">対局を申し込むにはログインしてください</small>}
          {u.gameId && (
            <Link className="button" to={`/game/${u.gameId}`}>
              観戦する
            </Link>
          )}
          <Link className="button" to={`/u/${u.username}`}>
            プロフィールを見る
          </Link>
        </div>
      )}
    </Modal>
  );
}

function SeekList({ lobby, onAccept, onCancel }: { lobby: LobbyState; onAccept: (s: Seek) => void; onCancel: (s: Seek) => void }) {
  const { user } = useAuth();
  if (!lobby.seeks.length) return <p className="empty">募集中の対局はありません。右のフォームから募集してみましょう。</p>;
  return (
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
              <Link to={`/u/${s.creator.username}`}>{s.creator.username}</Link> <span className="rank">{s.creator.rank}</span>
            </td>
            <td>
              {sizeLabel(s.size)} · {s.handicap ? `${s.handicap}子` : `コミ${s.komi}`} · {rulesLabel(s.ruleset)} ·{' '}
              {s.rated ? 'レート' : '自由'} · 募集者{colorLabel[s.color]}
            </td>
            <td>{describeClock(s.clock)}</td>
            <td className="actions">
              {user?.id === s.creator.id ? (
                <button onClick={() => onCancel(s)}>取り消す</button>
              ) : (
                <button className="primary" disabled={!user} onClick={() => onAccept(s)}>
                  対局する
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GameList({ lobby }: { lobby: LobbyState }) {
  if (!lobby.games.length) return <p className="empty">今は対局がありません</p>;
  return (
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
  );
}

const timeOf = (at: number) => new Date(at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

function LobbyChat({ messages }: { messages: LobbyChatMessage[] }) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setError('');
    const r = await call('lobbychat:send', text);
    if (r.ok) setText('');
    else setError(errorText(r.error));
  };

  return (
    <section className="card lobby-chat">
      <h2>ロビーチャット</h2>
      {user ? (
        <>
          <div className="chat-log" ref={listRef}>
            {messages.length ? (
              messages.map((m) => (
                <p key={m.id}>
                  <Link to={`/u/${m.user.username}`}>{m.user.username}</Link> <span className="rank">{m.user.rank}</span>
                  <time>{timeOf(m.at)}</time>
                  <br />
                  {m.text}
                </p>
              ))
            ) : (
              <p className="empty">まだ発言はありません。あいさつしてみましょう。</p>
            )}
          </div>
          {error && <p className="error">{error}</p>}
          <form className="chat-input" onSubmit={send}>
            <input value={text} maxLength={300} placeholder="メッセージ" onChange={(e) => setText(e.target.value)} aria-label="メッセージ" />
            <button className="primary" disabled={!text.trim()}>
              送信
            </button>
          </form>
        </>
      ) : (
        <p className="empty">
          <Link to="/login">ログイン</Link>するとチャットを読んだり書いたりできます。
        </p>
      )}
    </section>
  );
}

const NewGame = forwardRef<
  HTMLElement,
  { mode: Mode; setMode: (m: Mode) => void; onError: (e: string) => void }
>(function NewGame({ mode, setMode, onError }, ref) {
  return (
    <section className="card" ref={ref}>
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
});

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
  const submit = async (req: SeekRequest) => {
    onError('');
    const r = await call('seek:create', req);
    if (!r.ok) onError(errorText(r.error));
  };
  return (
    <>
      <GameForm submitLabel="募集する" onSubmit={submit} />
      <small className="meta">特定の人と打つときは、オンライン一覧からその人を選んで申し込めます。</small>
    </>
  );
}
