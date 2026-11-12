import { BLACK, GameView, PublicUser, Stone, WHITE, canBroadcast } from '@igo/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { Board, pointName } from '../components/Board';
import { Clock } from '../components/Clock';
import { Gauge, GaugeGraph, useGauge } from '../components/Gauge';
import { NarrationChoice, NarrationSelect, useNarration } from '../components/Narration';
import { Recording, canCrop, saveVideo, startTabRecording, tabRecordingUnsupported } from '../recorder';
import { call, getSocket } from '../socket';
import { clickSound, resultText } from './GamePage';

const STAGE_W = 1920;
const STAGE_H = 1080;

/** Operators' recording mode: a fixed 16:9 stage that looks finished as it is, plus recording controls outside it. */
export function BroadcastPage() {
  const { id = '' } = useParams();
  const { account, loading } = useAuth();
  if (loading) return <p className="empty">読み込み中…</p>;
  if (!canBroadcast(account?.role)) return <p className="empty">収録モードは運営だけが使えます</p>;
  return <Broadcast id={id} />;
}

function Broadcast({ id }: { id: string }) {
  const [params, setParams] = useSearchParams();
  const height = params.get('h') === '720' ? 720 : 1080;
  const fps = params.get('fps') === '30' ? 30 : 60;
  const showGauge = params.get('gauge') !== '0';
  const narr = params.get('narr');
  const narration: NarrationChoice = narr === 'ja' || narr === 'en' ? narr : 'off';
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
  };

  const [view, setView] = useState<GameView | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.broadcastInfo>> | null>(null);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const prevMoves = useRef<number | null>(null);
  const { gauge, error: gaugeError } = useGauge(id, showGauge);
  // Players who have not agreed to appear by name are only called Black and White.
  const narrationNames = view && info
    ? { black: info.consent.black ? view.black.username : '', white: info.consent.white ? view.white.username : '' }
    : null;
  const { intro: sayIntro } = useNarration({ view, names: narrationNames, gauge: showGauge ? gauge : null, lang: narration });

  useEffect(() => {
    const s = getSocket();
    const join = () =>
      void call<{ game: GameView }>('game:join', id).then((r) => {
        if (!r.ok) return setError(errorText(r.error));
        setView(r.game);
        setOffset(Date.now() - r.game.serverNow);
      });
    const onUpdate = (v: GameView) => {
      if (v.id !== id) return;
      setOffset(Date.now() - v.serverNow);
      setView(v);
      const n = v.state.moves.length;
      if (prevMoves.current !== null && n > prevMoves.current && v.state.moves[n - 1].p >= 0) clickSound();
      prevMoves.current = n;
    };
    join();
    s.on('connect', join);
    s.on('game:update', onUpdate);
    const t = setInterval(() => setNow(Date.now()), 100);
    api.broadcastInfo(id).then(setInfo, (e) => setError(errorText(e.message)));
    return () => {
      s.off('connect', join);
      s.off('game:update', onUpdate);
      s.emit('game:leave', id);
      clearInterval(t);
    };
  }, [id]);

  // ---- Fit the stage to the window ----
  const toolbar = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => {
      const top = toolbar.current?.offsetHeight ?? 0;
      setScale(Math.min(window.innerWidth / STAGE_W, (window.innerHeight - top) / STAGE_H));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // ---- Hide the cursor when it rests ----
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 2000);
  };

  // ---- Opening card, replayed when a recording starts ----
  const [intro, setIntro] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setIntro(0), 3200);
    return () => clearTimeout(t);
  }, [intro]);

  // ---- Recording ----
  const stage = useRef<HTMLDivElement>(null);
  const [rec, setRec] = useState<Recording | null>(null);
  const [recStart, setRecStart] = useState(0);
  const [recError, setRecError] = useState('');
  const unsupported = tabRecordingUnsupported();
  const methodReady = info?.recordingMethod === 'tab';

  const stop = async (r: Recording | null = rec) => {
    if (!r) return;
    setRec(null);
    const blob = await r.stop();
    const date = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    saveVideo(blob, `igo-${id}-${date}`);
  };
  const start = async () => {
    setRecError('');
    if (!stage.current) return;
    try {
      const r = await startTabRecording(stage.current, { fps, height });
      r.onEnded = () => void stop(r);
      setRec(r);
      setRecStart(Date.now());
      setIntro((n) => n + 1);
      sayIntro();
    } catch (e) {
      setRecError(e instanceof Error && e.name === 'NotAllowedError' ? '画面の共有が許可されませんでした' : String(e));
    }
  };
  useEffect(() => {
    if (!rec) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (error) return <p className="empty">{error}</p>;
  if (!view || !info) return <p className="empty">読み込み中…</p>;

  const st = view.state;
  const elapsed = view.turnStartedAt === null ? 0 : now - offset - view.turnStartedAt;
  const last = st.moves.at(-1);
  const shownName = (u: PublicUser, c: Stone) => (info.consent[c === BLACK ? 'black' : 'white'] ? u.username : c === BLACK ? '黒' : '白');
  // Without cropping, the whole tab is in the video: keep the controls out of it while recording.
  const hideToolbar = !!rec && !rec.cropped;
  const pixels = Math.round(STAGE_H * scale * window.devicePixelRatio);
  const recSeconds = rec ? Math.floor((now - recStart) / 1000) : 0;

  return (
    <div className="broadcast-page">
      <div className={`broadcast-toolbar${hideToolbar ? ' hidden' : ''}`} ref={toolbar}>
        <Link to="/admin">← 運営メニュー</Link>
        <label>
          画質
          <select value={height} disabled={!!rec} onChange={(e) => setParam('h', e.target.value)}>
            <option value="1080">1080p</option>
            <option value="720">720p</option>
          </select>
        </label>
        <label>
          <select value={fps} disabled={!!rec} onChange={(e) => setParam('fps', e.target.value)}>
            <option value="60">60fps</option>
            <option value="30">30fps</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={showGauge} onChange={(e) => setParam('gauge', e.target.checked ? '1' : '0')} />
          形勢ゲージ
        </label>
        <NarrationSelect value={narration} onChange={(v) => setParam('narr', v)} />
        {rec ? (
          <>
            <button className="danger" onClick={() => void stop()}>
              ■ 収録停止
            </button>
            <span className="rec-dot">● 収録中 {formatSec(recSeconds)}</span>
          </>
        ) : (
          <button className="primary" disabled={!!unsupported || !methodReady} onClick={() => void start()}>
            ● 収録開始
          </button>
        )}
        <span className="meta">
          {unsupported ??
            (!methodReady
              ? '設定されている収録方式はまだ使えません（運営メニューで「A. タブの収録」を選んでください）'
              : pixels < height
                ? `画面が小さいため、収録は約${pixels}pになります。ウィンドウを大きくしてください`
                : canCrop()
                  ? '収録開始で「このタブ」を選んでください。盤面の範囲だけが収録されます'
                  : 'このブラウザでは操作部分も映るため、収録中はこの帯を隠します。Esc キーで停止できます')}
        </span>
        {recError && <span className="error">{recError}</span>}
      </div>

      <div className="broadcast-fit" style={{ width: STAGE_W * scale, height: STAGE_H * scale }}>
        <div
          className={`stage${idle ? ' idle' : ''}`}
          ref={stage}
          style={{ transform: `scale(${scale})` }}
          onMouseMove={wake}
        >
          <header className="stage-top">
            <PlayerCard user={view.black} name={shownName(view.black, BLACK)} color={BLACK} toMove={st.phase === 'playing' && st.toMove === BLACK}>
              <Clock settings={view.clock} clock={view.clocks.black} elapsed={elapsed} running={st.phase === 'playing' && st.toMove === BLACK} />
              <span className="caps">アゲハマ {st.captures.black}</span>
            </PlayerCard>
            <div className="stage-gauge">
              {showGauge ? (
                gaugeError ? (
                  <p className="meta">{errorText(gaugeError)}</p>
                ) : (
                  <Gauge gauge={gauge} large />
                )
              ) : (
                <div className="stage-title">囲碁対局場</div>
              )}
            </div>
            <PlayerCard user={view.white} name={shownName(view.white, WHITE)} color={WHITE} toMove={st.phase === 'playing' && st.toMove === WHITE}>
              <Clock settings={view.clock} clock={view.clocks.white} elapsed={elapsed} running={st.phase === 'playing' && st.toMove === WHITE} />
              <span className="caps">アゲハマ {st.captures.white}</span>
            </PlayerCard>
          </header>

          <aside className="stage-left">
            <h3>対局情報</h3>
            <dl>
              <dt>盤</dt>
              <dd>{st.settings.size}路</dd>
              <dt>コミ</dt>
              <dd>{st.settings.komi}目</dd>
              {st.settings.handicap > 0 && (
                <>
                  <dt>置き石</dt>
                  <dd>{st.settings.handicap}子</dd>
                </>
              )}
              <dt>ルール</dt>
              <dd>{st.settings.ruleset === 'japanese' ? '日本ルール' : '中国ルール'}</dd>
              <dt>日付</dt>
              <dd>{new Date().toLocaleDateString('ja-JP')}</dd>
            </dl>
          </aside>

          <div className="stage-board">
            <Board size={st.settings.size} cells={st.cells} lastMove={last?.p} dead={st.dead} ownership={st.score?.ownership} />
          </div>

          <aside className="stage-right">
            <h3>直近の手</h3>
            <ol className="recent">
              {st.moves.slice(-8).map((m, i, arr) => {
                const n = st.moves.length - arr.length + i + 1;
                return (
                  <li key={n} className={i === arr.length - 1 ? 'latest' : ''}>
                    <span className="n">{n}</span>
                    <span className={`dot ${m.c === BLACK ? 'black' : 'white'}`} />
                    {pointName(m.p, st.settings.size)}
                  </li>
                );
              })}
            </ol>
            {showGauge && gauge && (
              <>
                <h3>形勢の推移</h3>
                <GaugeGraph evals={gauge.evals} total={st.moves.length} />
              </>
            )}
          </aside>

          <footer className="stage-bottom">
            <span>
              第{st.moves.length}手
              {st.phase === 'playing' ? ` ・ ${st.toMove === BLACK ? '黒' : '白'}番` : st.phase === 'scoring' ? ' ・ 整地中' : ''}
            </span>
            <span className="brand-mark">囲碁対局場</span>
          </footer>

          {intro > 0 && (
            <div className="stage-intro" key={intro}>
              <div className="intro-card black">
                <span className="dot black" />
                {shownName(view.black, BLACK)} <small>{view.black.rank}</small>
              </div>
              <div className="intro-title">対局開始</div>
              <div className="intro-card white">
                <span className="dot white" />
                {shownName(view.white, WHITE)} <small>{view.white.rank}</small>
              </div>
            </div>
          )}
          {st.phase === 'finished' && (
            <div className="stage-result">
              <div className="result-text">{resultText(st.result)}</div>
              {view.ratingChange && (
                <div className="result-rating">
                  黒 {signed(view.ratingChange.black)} ・ 白 {signed(view.ratingChange.white)}
                </div>
              )}
              {gauge && gauge.evals.length > 1 && <GaugeGraph evals={gauge.evals} total={st.moves.length} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayerCard(props: { user: PublicUser; name: string; color: Stone; toMove: boolean; children: React.ReactNode }) {
  const { user, name, color, toMove, children } = props;
  return (
    <div className={`stage-player ${color === BLACK ? 'black' : 'white'}${toMove ? ' to-move' : ''}`}>
      <span className={`dot ${color === BLACK ? 'black' : 'white'}`} />
      <div className="who">
        <span className="name">
          {name}
          {user.bot && <span className="badge ai">AI</span>}
        </span>
        <span className="rank">{user.rank}</span>
      </div>
      <div className="side">{children}</div>
    </div>
  );
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`;
const formatSec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
