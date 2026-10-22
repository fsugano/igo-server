import { BLACK, Stone, WHITE, handicapPoints } from './board.js';
import { GameSettings, Move, PASS } from './game.js';

export interface SgfInfo {
  blackName: string;
  whiteName: string;
  blackRank?: string;
  whiteRank?: string;
  result?: string | null;
  date?: string;
  timeLimitSec?: number;
  overtime?: string;
  place?: string;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/]/g, '\\]');

function coord(p: number, size: number): string {
  if (p === PASS) return '';
  return LETTERS[p % size] + LETTERS[Math.floor(p / size)];
}

export function toSgf(settings: GameSettings, moves: Move[], info: SgfInfo): string {
  const { size } = settings;
  const props: [string, string][] = [
    ['GM', '1'],
    ['FF', '4'],
    ['CA', 'UTF-8'],
    ['AP', 'igo:0.1'],
    ['SZ', String(size)],
    ['KM', String(settings.komi)],
    ['RU', settings.ruleset === 'japanese' ? 'Japanese' : 'Chinese'],
    ['PB', info.blackName],
    ['PW', info.whiteName],
  ];
  if (info.blackRank) props.push(['BR', info.blackRank]);
  if (info.whiteRank) props.push(['WR', info.whiteRank]);
  if (info.date) props.push(['DT', info.date]);
  if (info.place) props.push(['PC', info.place]);
  if (info.timeLimitSec !== undefined) props.push(['TM', String(info.timeLimitSec)]);
  if (info.overtime) props.push(['OT', info.overtime]);
  if (info.result) props.push(['RE', info.result]);
  let out = '(;' + props.map(([k, v]) => `${k}[${escape(v)}]`).join('');
  const hc = handicapPoints(size, settings.handicap);
  if (hc.length) {
    out += `HA[${hc.length}]AB` + hc.map(([x, y]) => `[${coord(y * size + x, size)}]`).join('');
  }
  out += '\n';
  moves.forEach((m, i) => {
    out += `;${m.c === BLACK ? 'B' : 'W'}[${coord(m.p, size)}]`;
    if ((i + 1) % 10 === 0) out += '\n';
  });
  return out.trimEnd() + ')\n';
}

export interface ParsedSgf {
  size: number;
  komi: number;
  handicap: number;
  props: Record<string, string[]>;
  moves: Move[];
}

/** Parses the main line of an SGF game record. Variations other than the first are skipped. */
export function parseSgf(text: string): ParsedSgf {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const expect = (ch: string) => {
    ws();
    if (text[i] !== ch) throw new Error(`SGF: expected '${ch}' at ${i}`);
    i++;
  };
  const value = (): string => {
    expect('[');
    let v = '';
    while (i < text.length && text[i] !== ']') {
      if (text[i] === '\\') i++;
      v += text[i++];
    }
    expect(']');
    return v;
  };
  const node = (): Record<string, string[]> => {
    expect(';');
    const props: Record<string, string[]> = {};
    for (;;) {
      ws();
      let id = '';
      while (i < text.length && /[A-Za-z]/.test(text[i])) {
        if (/[A-Z]/.test(text[i])) id += text[i];
        i++;
      }
      if (!id) return props;
      const vals: string[] = [];
      ws();
      while (text[i] === '[') {
        vals.push(value());
        ws();
      }
      props[id] = vals;
    }
  };
  const nodes: Record<string, string[]>[] = [];
  const tree = (collect: boolean) => {
    expect('(');
    ws();
    while (text[i] === ';') {
      const n = node();
      if (collect) nodes.push(n);
      ws();
    }
    let first = true;
    while (text[i] === '(') {
      tree(collect && first);
      first = false;
      ws();
    }
    expect(')');
  };
  i = text.indexOf('(');
  if (i < 0) throw new Error('not an SGF file');
  tree(true);
  const root = nodes[0] ?? {};
  const size = Number(root.SZ?.[0] ?? 19);
  const toPoint = (v: string) => (v === '' || (v === 'tt' && size <= 19) ? PASS : LETTERS.indexOf(v[1]) * size + LETTERS.indexOf(v[0]));
  const moves: Move[] = [];
  for (const n of nodes) {
    if (n.B) moves.push({ c: BLACK as Stone, p: toPoint(n.B[0]) });
    else if (n.W) moves.push({ c: WHITE as Stone, p: toPoint(n.W[0]) });
  }
  return {
    size,
    komi: Number(root.KM?.[0] ?? 0),
    handicap: Number(root.HA?.[0] ?? 0),
    props: root,
    moves,
  };
}
