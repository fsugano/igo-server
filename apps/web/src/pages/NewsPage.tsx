import { NEWS_CATEGORIES, NewsCategory, NewsItem } from '@igo/shared';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api';
import { Markdown } from '../components/Markdown';
import { getSocket } from '../socket';

export const newsDate = (t: number | null) => (t ? new Date(t).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }) : '');

export const CategoryTag = ({ c, important }: { c: NewsCategory; important?: boolean }) => (
  <>
    <span className={`news-cat ${c}`}>{NEWS_CATEGORIES[c]}</span>
    {important && <span className="news-cat important">重要</span>}
  </>
);

/** The news list (/news) and one item (/news/:id). */
export function NewsPage({ onOpenList }: { onOpenList?: () => void }) {
  const { id } = useParams();
  return id ? <NewsDetail id={id} /> : <NewsList onOpen={onOpenList} />;
}

function NewsList({ onOpen }: { onOpen?: () => void }) {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? '';
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setItems(null);
    api.news(category || undefined).then(
      (r) => {
        setItems(r.items);
        setMore(r.more);
      },
      (e) => setError(errorText(e.message)),
    );
  }, [category]);

  // Opening the list marks everything as read (again once the login is known).
  useEffect(() => onOpen?.(), [onOpen]);

  const loadMore = async () => {
    if (!items?.length) return;
    const r = await api.news(category || undefined, items[items.length - 1].id);
    setItems([...items, ...r.items]);
    setMore(r.more);
  };

  return (
    <div className="card news">
      <h2>お知らせ</h2>
      <div className="tabs news-tabs">
        {[['', 'すべて'], ...Object.entries(NEWS_CATEGORIES)].map(([c, label]) => (
          <button key={c} className={category === c ? 'active' : ''} onClick={() => setParams(c ? { category: c } : {})}>
            {label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {!items ? (
        <p className="empty">読み込み中…</p>
      ) : items.length === 0 ? (
        <p className="empty">お知らせはありません</p>
      ) : (
        <ul className="news-list">
          {items.map((n) => (
            <li key={n.id}>
              <Link to={`/news/${n.id}`}>
                <span className="news-meta">
                  {n.pinned && <span className="pin">📌</span>}
                  <CategoryTag c={n.category} important={n.important} />
                  <time>{newsDate(n.publishAt)}</time>
                </span>
                <span className="news-title">{n.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more && (
        <button className="more" onClick={() => void loadMore()}>
          もっと見る
        </button>
      )}
    </div>
  );
}

function NewsDetail({ id }: { id: string }) {
  const [item, setItem] = useState<NewsItem | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api.newsItem(id).then((r) => setItem(r.item), () => setMissing(true));
  }, [id]);
  if (missing) return <p className="empty">このお知らせは見つかりません（掲載が終わったかもしれません）</p>;
  if (!item) return <p className="empty">読み込み中…</p>;
  return (
    <article className="card news">
      <p className="news-meta">
        <CategoryTag c={item.category} important={item.important} />
        <time>{newsDate(item.publishAt)}</time>
      </p>
      <h2>{item.title}</h2>
      <Markdown text={item.body} />
      <p>
        <Link to="/news">‹ お知らせの一覧へ</Link>
      </p>
    </article>
  );
}

const DISMISSED_KEY = 'igo.news.dismissed';

function loadDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
  } catch {
    return [];
  }
}

/** Important news across the top of the lobby, until each is closed (remembered in this browser). */
export function NewsBanner() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed);
  useEffect(() => {
    api.importantNews().then((r) => setItems(r.items), () => {});
    // One published while the lobby is open appears straight away.
    const s = getSocket();
    const onNews = (n: Omit<NewsItem, 'body'>) => {
      if (n.important) setItems((list) => (list.some((x) => x.id === n.id) ? list : [{ ...n, body: '' }, ...list]));
    };
    s.on('news:published', onNews);
    return () => {
      s.off('news:published', onNews);
    };
  }, []);
  const close = (id: string) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Private mode: closed for this visit only.
    }
  };
  const shown = items.filter((n) => !dismissed.includes(n.id));
  if (!shown.length) return null;
  return (
    <div className="news-banners">
      {shown.map((n) => (
        <div key={n.id} className="news-banner" role="status">
          <span className="news-cat important">重要</span>
          <Link to={`/news/${n.id}`}>{n.title}</Link>
          <button className="link close" onClick={() => close(n.id)} aria-label="閉じる">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
