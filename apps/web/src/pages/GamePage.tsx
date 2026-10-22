import { BLACK, ChatMessage, Game, GameView, PublicUser, Stone, WHITE } from '@igo/shared';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GameRecord, api, errorText } from '../api';
import { useAuth } from '../auth';
import { Board, pointName } from '../components/Board';
import { Clock } from '../components/Clock';
import { call, getSocket } from '../socket';

export function resultText(r: string | null): string {
  if (!r) return '';
  if (r === 'Draw') return '持碁';
  const winner = r.startsWith('B') ? '黒' : '白';
  const how = r.slice(2);
  if (how === 'R') return `${winner}の中押し勝ち`;
  if (how === 'T') return `${winner}の時間勝ち`;
  const n = Number(how);
  const whole = Math.floor(n);
  return `${winner}の${whole ? `${whole}目` : ''}${n % 1 ? '半' : ''}勝ち`;
}

let audio: AudioContext | null = null;
function clickSound() {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(200, t + 0.05);
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + 0.1);
  } catch {
    /* audio unavailable */
  }
}

export function GamePage() {
  const { id = '' } = useParams();
  const [live, setLive] = useState<GameView | null>(null);
  const [record, setRecord] = useState<GameRecord | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setLive(null);
    setRecord(null);
    setMissing(false);
    const s = getSocket();
    const join = () =>
      void call<{ game: GameView }>('game:join', id).then(async (r) => {
        if (r.ok) setLive(r.game);
        else {
          try {
            setRecord(await api.game(id));
          } catch {
            setMissing(true);
          }
        }
      });
    join();
    s.on('connect', join);
    return () => {
      s.off('connect', join);
      s.emit('game:leave', id);
    };
  }, [id]);

  if (missing) return <p className="empty">対局が見つかりません</p>;
  if (live) return <LiveGame initial={live} />;
  if (record) return <Replay record={record} />;
  return <p className="empty">読み込み中…</p>;
}

function LiveGame({ initial }: { initial: GameView }) {
  const { user } = useAuth();
  const [view, setView] = useState(initial);
  const [offset, setOffset] = useState(Date.now() - initial.serverNow);
  const [now, setNow] = useState(Date.now());
  const [chat, setChat] = useState<ChatMessage[]>(initial.chat);
  const [error, setError] = useState('');
  const prevMoves = useRef(initial.state.moves.length);

  useEffect(() => {
    const s = getSocket();
    const onUpdate = (v: GameView) => {
      if (v.id !== initial.id) return;
      setOffset(Date.now() - v.serverNow);
      setView(v);
      setChat(v.chat);
      if (v.state.moves.length > prevMoves.current && v.state.moves[v.state.moves.length - 1].p >= 0) clickSound();
      prevMoves.current = v.state.moves.length;
    };
    const onChat = (gid: string, m: ChatMessage) => {
      if (gid === initial.id) setChat((c) => [...c, m]);
    };
    s.on('game:update', onUpdate);
    s.on('game:chat', onChat);
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => {
      s.off('game:update', onUpdate);
      s.off('game:chat', onChat);
      clearInterval(t);
    };
  }, [initial.id]);

  const st = view.state;
  const me: Stone | null = user ? (view.black.id === user.id ? BLACK : view.white.id === user.id ? WHITE : null) : null;
  const myTurn = me !== null && st.phase === 'playing' && st.toMove === me;
  const elapsed = view.turnStartedAt === null ? 0 : now - offset - view.turnStartedAt;
  const last = st.moves[st.moves.length - 1];

  const act = async (ev: Parameters<typeof call>[0], ...args: unknown[]) => {
    setError('');
    const r = await call(ev, view.id, ...args);
    if (!r.ok) setError(errorText(r.error));
  };

  const onPlay = (p: number) => {
    if (myTurn) void act('game:move', p, st.moves.length);
    else if (me && st.phase === 'scoring') void act('game:toggleDead', p);
  };

  const status =
    st.phase === 'finished'
      ? resultText(st.result)
      : st.phase === 'scoring'
        ? '整地中：死に石をクリックして指定し、双方が「合意」すると終局します'
        : myTurn
          ? 'あなたの番です'
          : `${st.toMove === BLACK ? '黒' : '白'}番`;

  return (
    <div className="game">
      <div className="board-wrap">
        <Board
          size={st.settings.size}
          cells={st.cells}
          lastMove={last?.p}
          ghost={myTurn ? me : null}
          onPlay={me && st.phase !== 'finished' ? onPlay : undefined}
          dead={st.dead}
          ownership={st.score?.ownership}
        />
      </div>
      <aside className="panel">
        <PlayerRow
          color={WHITE}
          user={view.white}
          captures={st.captures.white}
          toMove={st.phase === 'playing' && st.toMove === WHITE}
          clock={<Clock settings={view.clock} clock={view.clocks.white} elapsed={elapsed} running={st.phase === 'playing' && st.toMove === WHITE} />}
          ratingChange={view.ratingChange?.white}
        />
        <PlayerRow
          color={BLACK}
          user={view.black}
          captures={st.captures.black}
          toMove={st.phase === 'playing' && st.toMove === BLACK}
          clock={<Clock settings={view.clock} clock={view.clocks.black} elapsed={elapsed} running={st.phase === 'playing' && st.toMove === BLACK} />}
          ratingChange={view.ratingChange?.black}
        />
        <div className={`status${st.phase === 'finished' ? ' result' : ''}`}>{status}</div>
        <div className="meta">
          {st.moves.length}手目{last ? `（${last.c === BLACK ? '黒' : '白'} ${pointName(last.p, st.settings.size)}）` : ''} · コミ
          {st.settings.komi} · {st.settings.ruleset === 'japanese' ? '日本ルール' : '中国ルール'}
          {view.rated ? ' · レート対局' : ''} · 観戦 {view.spectators}
        </div>
        {st.score && st.phase !== 'playing' && (
          <div className="score">
            黒 {st.score.black} − 白 {st.score.white}
            <small>
              （地 {st.score.blackTerritory} / {st.score.whiteTerritory}
              {st.settings.ruleset === 'japanese'
                ? `・アゲハマ ${st.score.blackPrisoners} / ${st.score.whitePrisoners}`
                : `・石 ${st.score.blackStones} / ${st.score.whiteStones}`}
              ）
            </small>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {me && st.phase === 'playing' && (
          <div className="buttons">
            <button disabled={!myTurn} onClick={() => void act('game:pass', st.moves.length)}>
              パス
            </button>
            <button
              className="danger"
              onClick={() => {
                if (confirm('投了しますか？')) void act('game:resign');
              }}
            >
              投了
            </button>
          </div>
        )}
        {me && st.phase === 'scoring' && (
          <div className="buttons">
            <button className="primary" disabled={st.accepted.includes(me)} onClick={() => void act('game:acceptScore')}>
              {st.accepted.includes(me) ? '相手の合意待ち' : '合意する'}
            </button>
            <button onClick={() => void act('game:resume')}>対局再開</button>
          </div>
        )}
        <div className="buttons">
          <a className="button" href={`/api/games/${view.id}/sgf`}>
            棋譜(SGF)を保存
          </a>
          {st.phase === 'finished' && <Link className="button" to="/">ロビーへ</Link>}
        </div>
        <Chat gameId={view.id} messages={chat} canPost={!!user} />
      </aside>
    </div>
  );
}

function PlayerRow(props: {
  color: Stone;
  user: PublicUser;
  captures: number;
  toMove: boolean;
  clock: React.ReactNode;
  ratingChange?: number;
}) {
  const { color, user, captures, toMove, clock, ratingChange } = props;
  return (
    <div className={`player${toMove ? ' to-move' : ''}`}>
      <span className={`dot ${color === BLACK ? 'black' : 'white'}`} />
      <div className="who">
        <Link to={`/u/${user.username}`}>{user.username}</Link> <span className="rank">{user.rank}</span>
        {ratingChange !== undefined && ratingChange !== null && (
          <span className={ratingChange >= 0 ? 'up' : 'down'}>
            {' '}
            {ratingChange >= 0 ? '+' : ''}
            {ratingChange}
          </span>
        )}
        <small>アゲハマ {captures}</small>
      </div>
      {clock}
    </div>
  );
}

function Chat({ gameId, messages, canPost }: { gameId: string; messages: ChatMessage[]; canPost: boolean }) {
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo(0, box.current.scrollHeight);
  }, [messages.length]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const r = await call('game:chat', gameId, text);
    if (r.ok) setText('');
  };
  return (
    <div className="chat">
      <div className="messages" ref={box}>
        {messages.length === 0 && <p className="empty">チャット</p>}
        {messages.map((m, i) => (
          <p key={i}>
            <b>{m.user}</b> {m.text}
          </p>
        ))}
      </div>
      {canPost && (
        <form onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="メッセージ" />
        </form>
      )}
    </div>
  );
}

function Replay({ record }: { record: GameRecord }) {
  const [n, setN] = useState(record.moves.length);
  const game = useMemo(() => Game.fromMoves(record.settings, record.moves.slice(0, n)), [record, n]);
  const last = record.moves[n - 1];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setN((x) => Math.max(0, x - 1));
      if (e.key === 'ArrowRight') setN((x) => Math.min(record.moves.length, x + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [record.moves.length]);

  return (
    <div className="game">
      <div className="board-wrap">
        <Board size={record.settings.size} cells={Array.from(game.board.cells)} lastMove={last?.p} />
      </div>
      <aside className="panel">
        <PlayerRow color={WHITE} user={record.white} captures={game.capturesByWhite} toMove={false} clock={null} ratingChange={record.ratingChange?.white} />
        <PlayerRow color={BLACK} user={record.black} captures={game.capturesByBlack} toMove={false} clock={null} ratingChange={record.ratingChange?.black} />
        <div className="status result">{resultText(record.result)}</div>
        <div className="meta">
          {n} / {record.moves.length}手{last ? `（${last.c === BLACK ? '黒' : '白'} ${pointName(last.p, record.settings.size)}）` : ''} ·{' '}
          {new Date(record.startedAt).toLocaleString('ja-JP')}
        </div>
        <input
          type="range"
          className="slider"
          min={0}
          max={record.moves.length}
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
        />
        <div className="buttons">
          <button onClick={() => setN(0)}>|◀</button>
          <button onClick={() => setN((x) => Math.max(0, x - 1))}>◀</button>
          <button onClick={() => setN((x) => Math.min(record.moves.length, x + 1))}>▶</button>
          <button onClick={() => setN(record.moves.length)}>▶|</button>
        </div>
        <div className="buttons">
          <a className="button" href={`/api/games/${record.id}/sgf`}>
            棋譜(SGF)を保存
          </a>
        </div>
      </aside>
    </div>
  );
}
