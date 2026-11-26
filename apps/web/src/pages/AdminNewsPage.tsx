import { NEWS_CATEGORIES, NewsCategory, NewsItem } from '@igo/shared';
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { Markdown } from '../components/Markdown';
import { CategoryTag, newsDate } from './NewsPage';

type Draft = Omit<NewsItem, 'id'>;
const EMPTY: Draft = { title: '', body: '', category: 'info', important: false, pinned: false, publishAt: null, expireAt: null };

/** "2026-11-16T10:00" in local time for <input type="datetime-local">, and back. */
const toLocal = (t: number | null) => {
  if (t === null) return '';
  const d = new Date(t);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (s: string) => (s ? new Date(s).getTime() : null);

function statusOf(n: Draft): string {
  const now = Date.now();
  if (n.publishAt === null) return '下書き';
  if (n.publishAt > now) return `予約（${newsDate(n.publishAt)}）`;
  if (n.expireAt !== null && n.expireAt <= now) return '掲載終了';
  return '公開中';
}

/** Writing news (F-NEWS-09): drafts, preview, scheduled publishing, edits and removal. Admins only. */
export function AdminNewsPage() {
  const { account, loading } = useAuth();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const reload = () => api.adminNews().then((r) => setItems(r.items), (e) => setError(errorText(e.message)));
  useEffect(() => {
    if (account?.role === 'admin') void reload();
  }, [account?.role]);

  if (loading) return <p className="empty">読み込み中…</p>;
  if (account?.role !== 'admin') return <p className="empty">このページは管理者だけが使えます</p>;

  const save = async (publish: 'draft' | 'now' | 'keep') => {
    if (!editing) return;
    setError('');
    setMessage('');
    const d = editing.draft;
    const draft: Draft = { ...d, publishAt: publish === 'draft' ? null : publish === 'now' ? Date.now() : d.publishAt };
    try {
      const r = await api.saveNews(editing.id, draft);
      setEditing({ id: r.item.id, draft: r.item });
      setMessage(`保存しました（${statusOf(r.item)}）`);
      await reload();
    } catch (e) {
      setError(errorText((e as Error).message));
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('このお知らせを削除します。よろしいですか？')) return;
    await api.deleteNews(id).catch((e) => setError(errorText(e.message)));
    if (editing?.id === id) setEditing(null);
    await reload();
  };

  return (
    <div className="admin-news">
      <section className="card">
        <div className="row-head">
          <h2>お知らせの管理</h2>
          <span className="grow" />
          <Link to="/admin">運営メニューへ</Link>
          <button className="primary" onClick={() => setEditing({ id: null, draft: EMPTY })}>
            新しく書く
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {message && <p className="notice">{message}</p>}
        <table className="list">
          <thead>
            <tr>
              <th>タイトル</th>
              <th>状態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((n) => (
              <tr key={n.id}>
                <td>
                  <CategoryTag c={n.category} important={n.important} /> {n.pinned && '📌 '}
                  {n.title}
                </td>
                <td>{statusOf(n)}</td>
                <td className="actions">
                  <button onClick={() => setEditing({ id: n.id, draft: n })}>編集</button>{' '}
                  <button className="danger" onClick={() => void remove(n.id)}>
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <p className="empty">まだお知らせはありません</p>}
      </section>
      {editing && <Editor key={editing.id ?? 'new'} value={editing.draft} onChange={(draft) => setEditing({ ...editing, draft })} onSave={save} />}
    </div>
  );
}

function Editor({ value: d, onChange, onSave }: { value: Draft; onChange: (d: Draft) => void; onSave: (p: 'draft' | 'now' | 'keep') => void }) {
  const [preview, setPreview] = useState(false);
  const set = (patch: Partial<Draft>) => onChange({ ...d, ...patch });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave('keep');
  };
  return (
    <section className="card">
      <div className="tabs">
        <button className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>
          編集
        </button>
        <button className={preview ? 'active' : ''} onClick={() => setPreview(true)}>
          プレビュー
        </button>
      </div>
      {preview ? (
        <article className="news">
          <p className="news-meta">
            <CategoryTag c={d.category} important={d.important} />
          </p>
          <h2>{d.title || '（タイトル）'}</h2>
          <Markdown text={d.body} />
        </article>
      ) : (
        <form className="form" onSubmit={submit}>
          <label>
            タイトル
            <input value={d.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} required />
          </label>
          <div className="row">
            <label>
              カテゴリ
              <select value={d.category} onChange={(e) => set({ category: e.target.value as NewsCategory })}>
                {Object.entries(NEWS_CATEGORIES).map(([c, label]) => (
                  <option key={c} value={c}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              公開日時（空欄は下書き）
              <input type="datetime-local" value={toLocal(d.publishAt)} onChange={(e) => set({ publishAt: fromLocal(e.target.value) })} />
            </label>
            <label>
              掲載終了（任意）
              <input type="datetime-local" value={toLocal(d.expireAt)} onChange={(e) => set({ expireAt: fromLocal(e.target.value) })} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={d.important} onChange={(e) => set({ important: e.target.checked })} />
            重要（ロビーの上部に帯で表示）
          </label>
          <label className="check">
            <input type="checkbox" checked={d.pinned} onChange={(e) => set({ pinned: e.target.checked })} />
            一覧の先頭に固定
          </label>
          <label>
            本文（Markdown：# 見出し、**太字**、- 箇条書き、[文字](URL)。HTML は使えません）
            <textarea rows={12} value={d.body} maxLength={20000} onChange={(e) => set({ body: e.target.value })} />
          </label>
          <div className="buttons">
            <button type="button" onClick={() => onSave('draft')}>
              下書きとして保存
            </button>
            <button type="submit">日時のとおり保存</button>
            <button type="button" className="primary" onClick={() => onSave('now')}>
              今すぐ公開
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
