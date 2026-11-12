/**
 * A player's record (wins and losses broken down several ways) and a rough guess at their playing style,
 * both computed from their finished games.
 */
import { BLACK, Board, Stone, handicapPoints, opponent } from './board.js';
import type { GameSettings, Move } from './game.js';

/** One finished game, seen from the player's side. */
export interface StatsGame {
  id: string;
  color: Stone;
  opponent: string;
  vsBot: boolean;
  rated: boolean;
  settings: GameSettings;
  result: string | null;
  startedAt: number;
  moves: Move[];
  /** The player's rating before the game and its change (rated games only). */
  ratingBefore: number;
  ratingChange: number | null;
}

export type Outcome = 'W' | 'L' | 'D';

export interface WinLoss {
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface PlayerRecord {
  total: WinLoss;
  asBlack: WinLoss;
  asWhite: WinLoss;
  vsHuman: WinLoss;
  vsBot: WinLoss;
  rated: WinLoss;
  bySize: { size: number; record: WinLoss }[];
  /** How the games were won and lost. */
  winsBy: { resign: number; time: number; points: number };
  lossesBy: { resign: number; time: number; points: number };
  /** Positive: current winning streak, negative: losing streak. */
  streak: number;
  bestWinStreak: number;
  /** Most recent first, up to 10. */
  recent: Outcome[];
  averageMoves: number;
  /** Rating after each rated game, oldest first. */
  ratingHistory: { at: number; rating: number }[];
  /** Opponents played most often. */
  opponents: { name: string; vsBot: boolean; record: WinLoss }[];
}

const empty = (): WinLoss => ({ games: 0, wins: 0, losses: 0, draws: 0 });

export function outcomeOf(result: string | null, color: Stone): Outcome | null {
  if (!result) return null;
  if (result === 'Draw' || result === '0') return 'D';
  const winner = result.startsWith('B+') ? BLACK : result.startsWith('W+') ? opponent(BLACK) : null;
  if (winner === null) return null;
  return winner === color ? 'W' : 'L';
}

const add = (r: WinLoss, o: Outcome) => {
  r.games++;
  if (o === 'W') r.wins++;
  else if (o === 'L') r.losses++;
  else r.draws++;
};

export const winRate = (r: WinLoss) => (r.games - r.draws > 0 ? r.wins / (r.games - r.draws) : 0);

/** Builds the record. Games may come in any order. */
export function playerRecord(games: StatsGame[]): PlayerRecord {
  const rec: PlayerRecord = {
    total: empty(),
    asBlack: empty(),
    asWhite: empty(),
    vsHuman: empty(),
    vsBot: empty(),
    rated: empty(),
    bySize: [],
    winsBy: { resign: 0, time: 0, points: 0 },
    lossesBy: { resign: 0, time: 0, points: 0 },
    streak: 0,
    bestWinStreak: 0,
    recent: [],
    averageMoves: 0,
    ratingHistory: [],
    opponents: [],
  };
  const sizes = new Map<number, WinLoss>();
  const opps = new Map<string, { name: string; vsBot: boolean; record: WinLoss }>();
  const sorted = [...games].sort((a, b) => a.startedAt - b.startedAt);
  let moves = 0;
  let run = 0;

  for (const g of sorted) {
    const o = outcomeOf(g.result, g.color);
    if (!o) continue;
    add(rec.total, o);
    add(g.color === BLACK ? rec.asBlack : rec.asWhite, o);
    add(g.vsBot ? rec.vsBot : rec.vsHuman, o);
    if (g.rated) add(rec.rated, o);
    if (!sizes.has(g.settings.size)) sizes.set(g.settings.size, empty());
    add(sizes.get(g.settings.size)!, o);
    const opp = opps.get(g.opponent) ?? { name: g.opponent, vsBot: g.vsBot, record: empty() };
    add(opp.record, o);
    opps.set(g.opponent, opp);

    const how = g.result!.slice(2);
    const kind = how === 'R' ? 'resign' : how === 'T' ? 'time' : 'points';
    if (o === 'W') rec.winsBy[kind]++;
    if (o === 'L') rec.lossesBy[kind]++;

    if (o === 'W') run = run > 0 ? run + 1 : 1;
    else if (o === 'L') run = run < 0 ? run - 1 : -1;
    else run = 0;
    rec.bestWinStreak = Math.max(rec.bestWinStreak, run);
    rec.recent.unshift(o);
    moves += g.moves.length;
    if (g.rated && g.ratingChange !== null) {
      rec.ratingHistory.push({ at: g.startedAt, rating: Math.round(g.ratingBefore + g.ratingChange) });
    }
  }
  rec.streak = run;
  rec.recent = rec.recent.slice(0, 10);
  rec.averageMoves = rec.total.games ? Math.round(moves / rec.total.games) : 0;
  rec.bySize = [...sizes].sort((a, b) => a[0] - b[0]).map(([size, record]) => ({ size, record }));
  rec.opponents = [...opps.values()].sort((a, b) => b.record.games - a.record.games).slice(0, 5);
  return rec;
}

// ---------------------------------------------------------------------------------------------
// Playing style

export type StyleId = 'territory' | 'influence' | 'fighter' | 'balanced';
export type OpeningPoint = 'star' | 'komoku' | 'sansan' | 'mokuhazushi' | 'takamoku' | 'other';

export interface PlayStyle {
  /** False until there are enough games; then the other fields are only partly meaningful. */
  ready: boolean;
  /** Games still needed before a judgement. */
  needGames: number;
  gamesAnalyzed: number;
  style: StyleId;
  /** Each 0..100. */
  scores: {
    /** 100 = takes territory on the low lines, 0 = builds influence higher up. */
    territory: number;
    /** How often the player plays in contact with the opponent and captures. */
    fighting: number;
    /** How much of the game is played away from the edges. */
    center: number;
    /** Share of wins that ended before counting (resignation or time). */
    finishing: number;
  };
  /** Opening moves in the corners (13x13 and 19x19 only), most played first. */
  openings: { point: OpeningPoint; count: number }[];
  /** Short notes on what stands out. */
  traits: string[];
}

export const MIN_STYLE_GAMES = 5;
/** Own moves a game needs to count towards the style. */
const MIN_OWN_MOVES = 10;

const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));

/** Corner opening point, from the 0-based distances to the two nearest edges. */
export function openingPointOf(dx: number, dy: number): OpeningPoint {
  const [a, b] = dx < dy ? [dx, dy] : [dy, dx];
  if (a === 3 && b === 3) return 'star';
  if (a === 2 && b === 3) return 'komoku';
  if (a === 2 && b === 2) return 'sansan';
  if (a === 2 && b === 4) return 'mokuhazushi';
  if (a === 3 && b === 4) return 'takamoku';
  return 'other';
}

export function judgeStyle(games: StatsGame[]): PlayStyle {
  let openingMoves = 0;
  let openingLow = 0;
  let ownMoves = 0;
  let contact = 0;
  let captured = 0;
  let central = 0;
  let analyzed = 0;
  const openings = new Map<OpeningPoint, number>();

  for (const g of games) {
    const size = g.settings.size;
    const own = g.moves.filter((m) => m.c === g.color && m.p >= 0).length;
    if (own < MIN_OWN_MOVES) continue;
    analyzed++;
    // How far into the game counts as the opening, and which lines count as "low".
    const openingEnd = size >= 19 ? 50 : size >= 13 ? 30 : 14;
    const low = size >= 13 ? 3 : 2;
    const centralLine = size >= 19 ? 5 : size >= 13 ? 4 : 3;
    const cornerZone = size >= 19 ? 5 : 4;
    const corners = new Set<string>();

    let board = new Board(size);
    // Handicap stones are already on the board in the record's starting position.
    const hc = handicapPoints(size, g.settings.handicap);
    if (hc.length) board = board.withStones(hc.map(([x, y]) => board.idx(x, y)), BLACK);
    let ko = -1;
    for (let i = 0; i < g.moves.length; i++) {
      const m = g.moves[i];
      if (m.p < 0) {
        ko = -1;
        continue;
      }
      const mine = m.c === g.color;
      if (mine) {
        const x = m.p % size;
        const y = Math.floor(m.p / size);
        const dx = Math.min(x, size - 1 - x);
        const dy = Math.min(y, size - 1 - y);
        const line = Math.min(dx, dy) + 1;
        ownMoves++;
        if (line >= centralLine) central++;
        if (board.neighbors(m.p).some((q) => board.get(q) === opponent(g.color))) contact++;
        if (i < openingEnd) {
          openingMoves++;
          if (line <= low) openingLow++;
          if (size >= 13 && dx < cornerZone && dy < cornerZone) {
            const key = `${x < size / 2 ? 'L' : 'R'}${y < size / 2 ? 'T' : 'B'}`;
            if (!corners.has(key)) {
              corners.add(key);
              const pt = openingPointOf(dx, dy);
              openings.set(pt, (openings.get(pt) ?? 0) + 1);
            }
          }
        }
      }
      const r = board.play(m.p, m.c, ko);
      if (typeof r === 'string') break; // Not a legal record: analyse what came before.
      if (mine) captured += r.captured.length;
      board = r.board;
      ko = r.koPoint;
    }
  }

  const finished = games.map((g) => ({ o: outcomeOf(g.result, g.color), how: g.result?.slice(2) }));
  const wins = finished.filter((f) => f.o === 'W');
  const earlyWins = wins.filter((f) => f.how === 'R' || f.how === 'T').length;

  const lowShare = openingMoves ? openingLow / openingMoves : 0.5;
  const contactRate = ownMoves ? contact / ownMoves : 0;
  const capturesPer100 = ownMoves ? (captured / ownMoves) * 100 : 0;
  const scores = {
    // Typical openings put about half the moves on the low lines: spread that range over the scale.
    territory: clamp(50 + (lowShare - 0.5) * 160),
    fighting: clamp(((contactRate - 0.3) / 0.4) * 75 + Math.min(capturesPer100 / 10, 1) * 25),
    center: clamp((ownMoves ? central / ownMoves : 0) * 200),
    // Too few wins to tell: the middle of the scale.
    finishing: clamp(wins.length >= 3 ? (earlyWins / wins.length) * 100 : 50),
  };

  const style: StyleId =
    scores.fighting >= 65 ? 'fighter' : scores.territory >= 60 ? 'territory' : scores.territory <= 40 ? 'influence' : 'balanced';

  const traits: string[] = [];
  const opening = [...openings].sort((a, b) => b[1] - a[1]).map(([point, count]) => ({ point, count }));
  const totalCorners = opening.reduce((s, o) => s + o.count, 0);
  if (opening[0] && opening[0].point !== 'other' && totalCorners >= 4 && opening[0].count / totalCorners >= 0.5) {
    traits.push(`隅は${OPENING_LABELS[opening[0].point]}から打つことが多い`);
  }
  if (scores.fighting >= 65) traits.push('相手の石に接して打つ手が多く、戦いを好む');
  if (scores.fighting <= 30) traits.push('接触を避けて、穏やかに打つ');
  if (scores.center >= 60) traits.push('中央に向かって打つ手が多い');
  if (wins.length >= 3 && scores.finishing >= 60) traits.push('中押し・時間で決着をつけることが多い');
  if (wins.length >= 3 && scores.finishing <= 20) traits.push('最後まで打って、目数で勝つことが多い');

  return {
    ready: analyzed >= MIN_STYLE_GAMES,
    needGames: Math.max(0, MIN_STYLE_GAMES - analyzed),
    gamesAnalyzed: analyzed,
    style,
    scores,
    openings: opening,
    traits,
  };
}

export const STYLE_LABELS: Record<StyleId, { name: string; description: string }> = {
  territory: { name: '実利派', description: '三線以下に打って、確実に地を取ることを重視するタイプです。' },
  influence: { name: '厚み派', description: '四線より上に打って厚みを築き、それを戦いや模様に生かすタイプです。' },
  fighter: { name: '戦闘派', description: '相手の石に積極的に迫り、戦いの中で勝機をつかむタイプです。' },
  balanced: { name: 'バランス型', description: '地と厚みのどちらにも偏らず、局面に応じて打ち分けるタイプです。' },
};

export const OPENING_LABELS: Record<OpeningPoint, string> = {
  star: '星',
  komoku: '小目',
  sansan: '三々',
  mokuhazushi: '目外し',
  takamoku: '高目',
  other: 'その他',
};
