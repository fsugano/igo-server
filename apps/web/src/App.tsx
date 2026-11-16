import { canBroadcast } from '@igo/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { MessagesPage } from './pages/MessagesPage';
import { useSocial } from './social';
import { ChallengeCenter } from './components/ChallengeCenter';
import { Avatar } from './components/UserBits';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';
import { BroadcastPage } from './pages/BroadcastPage';
import { GamePage } from './pages/GamePage';
import { LobbyPage } from './pages/LobbyPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { getSocket } from './socket';
import { api } from './api';
import { NewsPage } from './pages/NewsPage';
import { AdminNewsPage } from './pages/AdminNewsPage';

export function App() {
  const { user, account, logout } = useAuth();
  const { unread } = useSocial();
  const navigate = useNavigate();
  const location = useLocation();

  // Jump into a game as soon as someone accepts our seek (or we accept theirs).
  useEffect(() => {
    const s = getSocket();
    const onStart = (id: string) => navigate(`/game/${id}`);
    s.on('game:start', onStart);
    return () => {
      s.off('game:start', onStart);
    };
  }, [navigate]);

  // Unread news: counted by the server on load, then one more for each item announced.
  const [newsUnread, setNewsUnread] = useState(0);
  const announced = useRef(new Set<string>());
  useEffect(() => {
    if (!user) return setNewsUnread(0);
    // The list marks everything read when it opens.
    if (window.location.pathname === '/news') return;
    api.newsUnread().then((r) => setNewsUnread(r.count), () => {});
  }, [user?.id]);
  useEffect(() => {
    const s = getSocket();
    const onNews = (n: { id: string }) => {
      if (announced.current.has(n.id)) return;
      announced.current.add(n.id);
      setNewsUnread((c) => c + 1);
    };
    s.on('news:published', onNews);
    return () => {
      s.off('news:published', onNews);
    };
  }, []);
  const readNews = useCallback(() => {
    setNewsUnread(0);
    if (user) void api.newsRead().catch(() => {});
  }, [user?.id]);

  // The recording mode fills the window with nothing around it.
  if (location.pathname.startsWith('/admin/broadcast/')) {
    return (
      <Routes>
        <Route path="/admin/broadcast/:id" element={<BroadcastPage />} />
      </Routes>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          囲碁対局場
        </Link>
        <nav>
          {user ? (
            <>
              {canBroadcast(account?.role) && <Link to="/admin">運営</Link>}
              <Link to="/news">
                お知らせ{newsUnread > 0 && <span className="count" aria-label={`未読${newsUnread}件`}>{newsUnread}</span>}
              </Link>
              <Link to="/messages" className="messages-link">
                メッセージ{unread > 0 && <span className="count" aria-label={`未読${unread}件`}>{unread}</span>}
              </Link>
              <Link to={`/u/${user.username}`} className="me">
                <Avatar u={user} size={24} /> {user.displayName} <span className="rank">{user.rank}</span>
              </Link>
              <button className="link" onClick={() => void logout()}>
                ログアウト
              </button>
            </>
          ) : (
            <>
              <Link to="/news">お知らせ</Link>
              <Link to="/login">ログイン / 新規登録</Link>
            </>
          )}
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<LobbyPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/game/:id" element={<GamePage />} />
          <Route path="/u/:username" element={<ProfilePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/settings/profile" element={<SettingsPage />} />
          <Route path="/news" element={<NewsPage onOpenList={readNews} />} />
          <Route path="/news/:id" element={<NewsPage />} />
          <Route path="/admin/news" element={<AdminNewsPage />} />
          <Route path="/messages/:userId" element={<MessagesPage />} />
          <Route path="*" element={<p className="empty">ページが見つかりません</p>} />
        </Routes>
      </main>
      <ChallengeCenter />
    </div>
  );
}
