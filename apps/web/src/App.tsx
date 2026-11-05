import { canBroadcast } from '@igo/shared';
import { useEffect } from 'react';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { AdminPage } from './pages/AdminPage';
import { BroadcastPage } from './pages/BroadcastPage';
import { GamePage } from './pages/GamePage';
import { LobbyPage } from './pages/LobbyPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { getSocket } from './socket';

export function App() {
  const { user, account, logout } = useAuth();
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
              <Link to={`/u/${user.username}`} className="me">
                {user.username} <span className="rank">{user.rank}</span>
              </Link>
              <button className="link" onClick={() => void logout()}>
                ログアウト
              </button>
            </>
          ) : (
            <Link to="/login">ログイン / 新規登録</Link>
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
          <Route path="*" element={<p className="empty">ページが見つかりません</p>} />
        </Routes>
      </main>
    </div>
  );
}
