import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorText } from '../api';
import { useAuth } from '../auth';

const RANKS = [
  ...Array.from({ length: 25 }, (_, i) => `${25 - i}k`),
  ...Array.from({ length: 9 }, (_, i) => `${i + 1}d`),
];
const rankName = (r: string) => (r.endsWith('k') ? `${parseInt(r)}級` : `${parseInt(r)}段`);

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rank, setRank] = useState('10k');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = mode === 'login' ? await api.login(username, password) : await api.register(username, password, rank);
      setUser(r.user);
      navigate('/');
    } catch (err) {
      setError(errorText((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card narrow">
      <div className="tabs">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
          ログイン
        </button>
        <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
          新規登録
        </button>
      </div>
      <form onSubmit={submit} className="form">
        <label>
          ユーザー名
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        {mode === 'register' && <small>半角英数字と _ の3〜16文字</small>}
        <label>
          パスワード
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined}
            required
          />
        </label>
        {mode === 'register' && (
          <label>
            自己申告の棋力
            <select value={rank} onChange={(e) => setRank(e.target.value)}>
              {RANKS.map((r) => (
                <option key={r} value={r}>
                  {rankName(r)}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {mode === 'login' ? 'ログイン' : '登録して始める'}
        </button>
      </form>
    </div>
  );
}
