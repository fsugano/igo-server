import Anthropic from '@anthropic-ai/sdk';
import { BLACK, ChatMessage, Game, PASS, Stone } from '@igo/shared';
import { analyze, estimateMargin } from './builtin.js';
import { toVertex } from './gtp.js';

/** What a computer player knows when someone talks to it in the game chat. */
export interface ChatContext {
  /** A private copy of the game. */
  game: Game;
  botColor: Stone;
  botName: string;
  opponentName: string;
  /** Recent chat, oldest first, ending with the message to answer. */
  history: ChatMessage[];
}

/** Gives computer players something to say. Returns null to stay silent. */
export interface ChatResponder {
  readonly kind: 'canned' | 'claude';
  reply(ctx: ChatContext): Promise<string | null>;
}

export const LINES = {
  greeting: 'よろしくお願いします。',
  thanks: 'ありがとうございました。',
  tired: 'たくさんお話ししましたね。ここからは対局に集中します。',
};

const CANNED_REPLIES = ['ふむふむ。', 'いい勝負ですね。', 'じっくり考えて打ちます。', 'その手は気になっていました。', 'がんばります。'];

/** Set phrases, no network. Used when no API key is configured, and when the API fails. */
export class CannedChat implements ChatResponder {
  readonly kind = 'canned';
  private n = 0;

  async reply(ctx: ChatContext): Promise<string> {
    const text = ctx.history.at(-1)?.text ?? '';
    if (/よろしく|お願いします|hello|hi\b|こんにちは/i.test(text)) return LINES.greeting;
    if (/ありがと|thank/i.test(text)) return 'こちらこそ。';
    return CANNED_REPLIES[this.n++ % CANNED_REPLIES.length];
  }
}

const SYSTEM = `You are a computer Go player (igo / baduk / weiqi) on an online Go server, chatting with your opponent in the game's chat box while you play.
- Reply in the language the opponent writes in.
- Keep each reply short: one to three sentences of plain text, no markdown.
- Be friendly and sporting, like a good club opponent. You may tease lightly; never be rude.
- You can talk about the game. Base anything you say about the position on the position report you are given; it comes from a quick estimate, so speak about it loosely ("I think", "it looks like"). Never invent stones or moves that are not in the report.
- Coordinates use columns A-T without I, and rows numbered from the bottom (e.g. D4).
- You cannot change the game (no undo, no handicap changes); if asked, say so kindly.`;

/** Real conversation through the Claude API. */
export class ClaudeChat implements ChatResponder {
  readonly kind = 'claude';

  constructor(
    private client: Anthropic,
    private model: string,
  ) {}

  async reply(ctx: ChatContext): Promise<string | null> {
    // Server-side fallback re-runs a declined request on another model; Haiku has none.
    const fallback = !/haiku/.test(this.model);
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      system: SYSTEM,
      messages: [{ role: 'user', content: await prompt(ctx) }],
    });
    if (res.stop_reason === 'refusal') return null;
    const text = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    return text ? text.slice(0, 300) : null;
  }
}

export function chatResponder(env: NodeJS.ProcessEnv = process.env): ChatResponder {
  if (!env.ANTHROPIC_API_KEY) return new CannedChat();
  return new ClaudeChat(new Anthropic(), env.AI_CHAT_MODEL || 'claude-opus-5-5');
}

const colorName = (c: Stone) => (c === BLACK ? 'Black' : 'White');

async function prompt(ctx: ChatContext): Promise<string> {
  const { game, botColor } = ctx;
  const { size, komi, ruleset, handicap } = game.settings;
  const rows: string[] = [];
  const cols = 'ABCDEFGHJKLMNOPQRST'.slice(0, size);
  rows.push(`   ${[...cols].join(' ')}`);
  for (let y = 0; y < size; y++) {
    const line = [...game.board.cells.slice(y * size, (y + 1) * size)].map((c) => '.XO'[c]).join(' ');
    rows.push(`${String(size - y).padStart(2)} ${line}`);
  }
  const recent = game.moves
    .slice(-12)
    .map((m) => `${m.c === BLACK ? 'B' : 'W'} ${m.p === PASS ? 'pass' : toVertex(m.p, size)}`)
    .join(', ');
  let estimate = '';
  if (game.phase === 'playing' && game.moves.length > 0) {
    const a = await analyze(game, game.toMove, { playouts: 600, maxMs: 500 });
    const margin = estimateMargin(a.ownership, komi);
    const lead = Math.abs(Math.round(margin));
    estimate = `Quick estimate: ${lead < 2 ? 'roughly even' : `${margin > 0 ? 'Black' : 'White'} ahead by about ${lead} points`}.`;
  }
  const chat = ctx.history.map((m) => `${m.user === ctx.botName ? 'You' : m.user}: ${m.text}`).join('\n');
  return [
    `You are ${ctx.botName}, playing ${colorName(botColor)} (${botColor === BLACK ? 'X' : 'O'}). Your opponent is ${ctx.opponentName}.`,
    `Game: ${size}x${size}, komi ${komi}, ${ruleset} rules${handicap ? `, ${handicap} handicap stones` : ''}. Move ${game.moves.length}, phase: ${game.phase}${game.phase === 'playing' ? `, ${colorName(game.toMove)} to play` : ''}.`,
    `Captures: Black ${game.capturesByBlack}, White ${game.capturesByWhite}. Recent moves: ${recent || 'none'}.`,
    estimate,
    `Board (X black, O white):\n${rows.join('\n')}`,
    `Chat so far:\n${chat}`,
    `Write your next chat message.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
