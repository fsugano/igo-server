import { ReactNode } from 'react';

/**
 * A small Markdown renderer for news: headings, paragraphs, lists, quotes, code, bold, italics, links and line breaks.
 * It builds React elements and never sets HTML, so HTML written in the text is shown as text (no XSS).
 * Only http(s), mailto and same-site links are made clickable; links to other sites open in a new tab without
 * giving it access to this page (rel="noopener noreferrer").
 */
export function Markdown({ text }: { text: string }) {
  return <div className="markdown">{blocks(text.replace(/\r\n?/g, '\n'))}</div>;
}

function blocks(src: string): ReactNode[] {
  const lines = src.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  const key = () => out.length;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(
        <pre key={key()}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length + 2, 6);
      const Tag = `h${level}` as 'h3';
      out.push(<Tag key={key()}>{inline(h[2])}</Tag>);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      out.push(<hr key={key()} />);
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      const List = ordered ? 'ol' : 'ul';
      out.push(
        <List key={key()}>
          {items.map((t, n) => (
            <li key={n}>{inline(t)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(<blockquote key={key()}>{blocks(quote.join('\n'))}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
    out.push(
      <p key={key()}>
        {para.map((t, n) => (
          <span key={n}>
            {n > 0 && <br />}
            {inline(t)}
          </span>
        ))}
      </p>,
    );
  }
  return out;
}

const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/))/i;

/** `code`, **bold**, *italic*, [text](url) and bare https:// links. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = out.length;
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={k}>{inline(m[2])}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k}>{inline(m[3])}</em>);
    else if (m[4] !== undefined) out.push(link(m[5], inline(m[4]), k));
    else out.push(link(m[6], m[6], k));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function link(url: string, label: ReactNode, key: number): ReactNode {
  if (!SAFE_URL.test(url)) return <span key={key}>{label}</span>;
  const external = /^https?:/i.test(url);
  return (
    <a key={key} href={url} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {label}
    </a>
  );
}
