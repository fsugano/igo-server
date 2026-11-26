import { REPORT_REASONS, Report } from '@igo/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { Avatar, UserName } from '../components/UserBits';

const TARGET: Record<Report['targetType'], string> = { user: '利用者', avatar: 'プロフィール画像', lobbychat: 'ロビーチャット', dm: '1対1のメッセージ' };
const ACTION: Record<string, string> = {
  dismiss: '問題なし（却下）',
  warn: '注意した（記録のみ）',
  remove_avatar: '画像を削除',
  delete_message: 'メッセージを削除',
  ban: '利用停止',
};

/** Reports from users (M-UGC-04): look at what was reported and act on it. Admins only; every action is audited. */
export function AdminReportsPage() {
  const { account, loading } = useAuth();
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState('');

  const reload = () => api.adminReports(status).then((r) => setReports(r.reports), (e) => setError(errorText(e.message)));
  useEffect(() => {
    if (account?.role === 'admin') void reload();
  }, [account?.role, status]);

  if (loading) return <p className="empty">読み込み中…</p>;
  if (account?.role !== 'admin') return <p className="empty">このページは管理者だけが使えます</p>;

  const resolve = async (r: Report, action: string) => {
    if (action === 'ban' && !window.confirm(`${r.targetUser?.displayName ?? 'この人'}を利用停止にします。よろしいですか？`)) return;
    setError('');
    try {
      await api.resolveReport(r.id, action);
      await reload();
    } catch (e) {
      setError(errorText((e as Error).message));
    }
  };

  const actionsFor = (r: Report) =>
    ['dismiss', 'warn', ...(r.targetType === 'avatar' ? ['remove_avatar'] : []), ...(r.targetType === 'lobbychat' || r.targetType === 'dm' ? ['delete_message'] : []), 'ban'];

  return (
    <div className="card admin-news">
      <div className="row-head">
        <h2>通報の確認</h2>
        <span className="grow" />
        <Link to="/admin">運営メニューへ</Link>
      </div>
      <div className="tabs">
        <button className={status === 'open' ? 'active' : ''} onClick={() => setStatus('open')}>
          未対応
        </button>
        <button className={status === 'closed' ? 'active' : ''} onClick={() => setStatus('closed')}>
          対応済み
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!reports ? (
        <p className="empty">読み込み中…</p>
      ) : reports.length === 0 ? (
        <p className="empty">{status === 'open' ? '未対応の通報はありません' : '対応済みの通報はありません'}</p>
      ) : (
        <ul className="reports">
          {reports.map((r) => (
            <li key={r.id} className="card">
              <p className="news-meta">
                <span className="news-cat">{TARGET[r.targetType]}</span>
                <span className="news-cat important">{REPORT_REASONS[r.reason]}</span>
                <time>{new Date(r.at).toLocaleString('ja-JP')}</time>
                {r.reporter && <span>通報者：{r.reporter.displayName}</span>}
              </p>
              {r.targetUser && (
                <p className="who-line">
                  <Avatar u={r.targetUser} size={32} />
                  <UserName u={r.targetUser} link />
                </p>
              )}
              {r.snapshot && r.targetType === 'avatar' ? (
                <img className="reported-avatar" src={`/avatars/${r.snapshot}-256.webp`} alt="通報された画像" width={128} height={128} />
              ) : (
                r.snapshot && <blockquote className="snapshot">{r.snapshot}</blockquote>
              )}
              {r.detail && <p className="meta">通報者のコメント：{r.detail}</p>}
              {r.status === 'open' ? (
                <div className="buttons">
                  {actionsFor(r).map((a) => (
                    <button key={a} className={a === 'ban' ? 'danger' : ''} onClick={() => void resolve(r, a)}>
                      {ACTION[a]}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="meta">対応：{ACTION[r.action ?? ''] ?? r.action}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
