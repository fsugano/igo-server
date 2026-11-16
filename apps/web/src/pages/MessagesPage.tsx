import type { DirectMessage, PublicUser } from '@igo/shared';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { ChallengeDialog } from '../components/ChallengeDialog';
import { useSocial } from '../social';
import { call } from '../socket';

const when = (at: number) => {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
};

/** Messages between two people: the list of conversations, and the one open. */
export function MessagesPage() {
  const { userId } = useParams();
  const { user } = useAuth();
  const { conversations } = useSocial();
  if (!user) {
    return (
      <p className="empty">
        メッセージを使うには<Link to="/login">ログイン</Link>してください。
      </p>
    );
  }
  return (
    <div className={`messages${userId ? ' open' : ''}`}>
      <section className="card conversations">
        <h2>メッセージ</h2>
        {conversations.length ? (
          <ul>
            {conversations.map((c) => (
              <li key={c.user.id}>
                <Link to={`/messages/${c.user.id}`} className={c.user.id === userId ? 'active' : ''}>
                  <span className="avatar">{c.user.username.slice(0, 1).toUpperCase()}</span>
                  <span className="who">
                    <strong>{c.user.username}</strong>
                    <small>{c.last.fromId === user.id ? `あなた：${c.last.text}` : c.last.text}</small>
                  </span>
                  <span className="side-info">
                    <small>{when(c.last.at)}</small>
                    {c.unread > 0 && <span className="count">{c.unread}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">まだメッセージはありません。ロビーの一覧から相手を選んで「チャット」を押すと始められます。</p>
        )}
      </section>
      {userId ? <Thread key={userId} userId={userId} /> : <section className="card thread empty-thread"><p className="empty">左の一覧から相手を選んでください</p></section>}
    </div>
  );
}

function Thread({ userId }: { userId: string }) {
  const { user } = useAuth();
  const { onMessage, refreshConversations, following, setFollow } = useSocial();
  const navigate = useNavigate();
  const [other, setOther] = useState<PublicUser | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void call<{ user: PublicUser; messages: DirectMessage[] }>('dm:history', userId).then((r) => {
      if (!r.ok) return setError(errorText(r.error));
      setOther(r.user);
      setMessages(r.messages);
      refreshConversations();
    });
    return onMessage((m) => {
      if (m.fromId !== userId && m.toId !== userId) return;
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
      // Read while it is open.
      if (m.fromId === userId) void call('dm:read', userId).then(refreshConversations);
    });
  }, [userId]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setError('');
    const r = await call<{ message: DirectMessage }>('dm:send', userId, text);
    if (!r.ok) return setError(errorText(r.error));
    setText('');
    setMessages((list) => (list.some((x) => x.id === r.message.id) ? list : [...list, r.message]));
  };

  const follows = following.has(userId);

  return (
    <section className="card thread">
      <div className="thread-head">
        <button className="link back" onClick={() => navigate('/messages')} aria-label="一覧に戻る">
          ‹
        </button>
        {other ? (
          <>
            <Link to={`/u/${other.username}`}>
              <strong>{other.username}</strong> <span className="rank">{other.rank}</span>
            </Link>
            <span className="grow" />
            <button onClick={() => void setFollow(userId, !follows).then((e) => e && setError(errorText(e)))}>
              {follows ? 'フォロー中' : 'フォローする'}
            </button>
            <button className="primary" onClick={() => setAsking(true)}>
              対局を申し込む
            </button>
          </>
        ) : (
          <span className="empty">{error || '読み込み中…'}</span>
        )}
      </div>
      <div className="dm-log" ref={logRef}>
        {messages.map((m) => (
          <div key={m.id} className={`bubble${m.fromId === user?.id ? ' mine' : ''}`}>
            <p>{m.text}</p>
            <small>
              {when(m.at)}
              {m.fromId === user?.id && m.readAt && ' · 既読'}
            </small>
          </div>
        ))}
        {other && !messages.length && <p className="empty">まだメッセージはありません。</p>}
      </div>
      {other && error && <p className="error">{error}</p>}
      {other && (
        <form className="chat-input" onSubmit={send}>
          <input value={text} maxLength={300} placeholder="メッセージ" onChange={(e) => setText(e.target.value)} aria-label="メッセージ" />
          <button className="primary" disabled={!text.trim()}>
            送信
          </button>
        </form>
      )}
      {asking && other && <ChallengeDialog to={other} onClose={() => setAsking(false)} />}
    </section>
  );
}
