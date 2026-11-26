import type { Challenge, ChallengeUpdate, PublicUser } from '@igo/shared';
import { DECLINE_REASONS } from '@igo/shared';
import { useEffect, useRef, useState } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { call, getSocket } from '../socket';
import { Avatar, LevelBadge, UserName } from './UserBits';
import { GameForm, colorLabel, describeConditions, otherColor } from './GameForm';
import { Modal } from './Modal';

interface Note {
  id: number;
  text: string;
}

/** Whole seconds until it lapses (never more than the full minute, whatever the clocks say). */
const secondsLeft = (c: Challenge, now: number) => Math.min(60, Math.max(0, Math.ceil((c.expiresAt - now) / 1000)));

/**
 * Challenges to and from me, on every page: a dialog for one received, a bar for one sent,
 * and short notes on how they ended. Accepting starts the game, and App moves to it on game:start.
 */
export function ChallengeCenter() {
  const { user } = useAuth();
  const [open, setOpen] = useState<Challenge[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [now, setNow] = useState(Date.now());
  const openRef = useRef(open);
  openRef.current = open;

  const note = (text: string) => {
    const id = Math.random();
    setNotes((n) => [...n, { id, text }]);
    setTimeout(() => setNotes((n) => n.filter((x) => x.id !== id)), 8000);
  };

  useEffect(() => {
    if (!user) {
      setOpen([]);
      return;
    }
    const s = getSocket();
    const load = () =>
      void call<{ challenges: Challenge[] }>('challenge:list').then((r) => {
        if (r.ok) setOpen(r.challenges);
      });
    const onReceived = (c: Challenge) => setOpen((list) => (list.some((x) => x.id === c.id) ? list : [...list, c]));
    const onUpdated = (u: ChallengeUpdate) => {
      // Read the list from the ref: a state updater may run twice, and the note must be shown once.
      const c = openRef.current.find((x) => x.id === u.id);
      if (c && c.from.id === user.id) {
        const to = c.to.displayName;
        if (u.outcome === 'declined') note(`${to}さんに断られました${u.reason ? `：「${u.reason}」` : ''}`);
        if (u.outcome === 'expired') note(`${to}さんから返事がありませんでした`);
        if (u.outcome === 'cancelled') note(`${to}さんへの申し込みは取り消されました`);
        if (u.outcome === 'countered') note(`${to}さんが条件を変えて返しました`);
      } else if (c && u.outcome === 'cancelled') note(`${c.from.displayName}さんの申し込みは取り消されました`);
      setOpen((list) => list.filter((x) => x.id !== u.id));
    };
    load();
    s.on('connect', load);
    s.on('challenge:received', onReceived);
    s.on('challenge:updated', onUpdated);
    return () => {
      s.off('connect', load);
      s.off('challenge:received', onReceived);
      s.off('challenge:updated', onUpdated);
    };
  }, [user?.id]);

  // A short note when a finished game raises my level.
  const levelRef = useRef<{ id: string; level: number } | null>(null);
  useEffect(() => {
    if (!user) return;
    const prev = levelRef.current;
    if (prev && prev.id === user.id && user.level > prev.level) note(`レベルが上がりました！ Lv${user.level}`);
    levelRef.current = { id: user.id, level: user.level };
  }, [user?.id, user?.level]);

  useEffect(() => {
    if (!open.length) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open.length]);

  if (!user) return null;
  const incoming = open.find((c) => c.to.id === user.id);
  const outgoing = open.find((c) => c.from.id === user.id);

  return (
    <>
      {incoming && <Incoming key={incoming.id} c={incoming} left={secondsLeft(incoming, now)} />}
      <div className="toasts" aria-live="polite">
        {outgoing && (
          <div className="toast">
            <span>
              {outgoing.to.displayName}さんに申し込み中…（残り{secondsLeft(outgoing, now)}秒）
            </span>
            <button
              onClick={() =>
                void call('challenge:cancel', outgoing.id).then((r) => {
                  if (!r.ok) note(errorText(r.error));
                })
              }
            >
              取り消す
            </button>
          </div>
        )}
        {notes.map((n) => (
          <div key={n.id} className="toast">
            {n.text}
          </div>
        ))}
      </div>
    </>
  );
}

const Who = ({ u }: { u: PublicUser }) => (
  <span className="who-line">
    <Avatar u={u} size={32} />
    <strong>
      <UserName u={u} />
    </strong>
    <LevelBadge level={u.level} />
  </span>
);

function Incoming({ c, left }: { c: Challenge; left: number }) {
  const [mode, setMode] = useState<'view' | 'decline' | 'counter'>('view');
  const [reason, setReason] = useState<string>(DECLINE_REASONS[0]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const respond = async (answer: 'accept' | 'decline' | 'counter', detail: object = {}) => {
    setError('');
    setSending(true);
    const r = await call('challenge:respond', c.id, answer, detail);
    setSending(false);
    if (!r.ok) setError(errorText(r.error));
  };

  // The request is from the challenger's side; show it from mine.
  const mine = otherColor(c.request.color);

  return (
    <Modal title={c.counterOf ? '条件を変えた申し込みが届きました' : '対局の申し込みが届きました'}>
      <p>
        <Who u={c.from} /> さんから
      </p>
      <p className="conditions">
        {describeConditions(c.request)} · あなたは{colorLabel[mine]}
      </p>
      <p className="meta">残り{left}秒で締め切られます</p>
      {error && <p className="error">{error}</p>}
      {mode === 'view' && (
        <div className="buttons">
          <button onClick={() => setMode('decline')} disabled={sending}>
            断る
          </button>
          {!c.counterOf && (
            <button onClick={() => setMode('counter')} disabled={sending}>
              条件を変えて返す
            </button>
          )}
          <button className="primary" onClick={() => void respond('accept')} disabled={sending}>
            受ける
          </button>
        </div>
      )}
      {mode === 'decline' && (
        <div className="form">
          <label>
            断るときのひとこと
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {DECLINE_REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <div className="buttons">
            <button onClick={() => setMode('view')}>戻る</button>
            <button className="danger" onClick={() => void respond('decline', { reason })} disabled={sending}>
              断る
            </button>
          </div>
        </div>
      )}
      {mode === 'counter' && (
        <GameForm
          initial={{ ...c.request, color: mine }}
          submitLabel="この条件で返す"
          onCancel={() => setMode('view')}
          onSubmit={(request) => respond('counter', { request })}
        />
      )}
    </Modal>
  );
}
