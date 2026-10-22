import { useEffect } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { GamePage } from './pages/GamePage';
import { LobbyPage } from './pages/LobbyPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { getSocket } from './socket';

export function App() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Jump into a game as soon as someone accepts our seek (or we accept theirs).
  useEffect(() => {
    const s = getSocket();
    const onStart = (id: string) => navigate(`/game/${id}`);
    s.on('game:start', onStart);
    return () => {
      s.off('game:start', onStart);
    };
  }, [navigate]);

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
          <Route path="*" element={<p className="empty">ページが見つかりません</p>} />
        </Routes>
      </main>
    </div>
  );
}
