import { BLACK, Game, WHITE } from '@igo/shared';
import { describe, expect, it } from 'vitest';
import { CannedChat, ClaudeChat, chatResponder } from '../src/ai/chat.js';

const S9 = { size: 9, komi: 6.5, handicap: 0, ruleset: 'japanese' as const };

function fakeClient(reply: object) {
  const calls: any[] = [];
  const client = { beta: { messages: { create: async (p: any) => (calls.push(p), reply) } } };
  return { client: client as any, calls };
}

describe('AI chat', () => {
  const game = new Game(S9);
  game.play(BLACK, 40);
  const ctx = {
    game,
    botColor: WHITE as 2,
    botName: 'AI-Lv1',
    opponentName: 'fumito',
    history: [{ user: 'fumito', text: 'Is my tengen good?', at: 0 }],
  };

  it('uses set phrases without an API key', async () => {
    expect(chatResponder({}).kind).toBe('canned');
    expect(chatResponder({ ANTHROPIC_API_KEY: 'x' }).kind).toBe('claude');
    expect(await new CannedChat().reply({ ...ctx, history: [{ user: 'a', text: 'よろしくお願いします', at: 0 }] })).toBe('よろしくお願いします。');
  });

  it('sends the position and chat to Claude and returns its text', async () => {
    const { client, calls } = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: ' Bold start! ' }] });
    expect(await new ClaudeChat(client, 'claude-opus-5-5').reply(ctx)).toBe('Bold start!');
    const p = calls[0];
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.fallbacks).toBe('default');
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01']);
    const text = p.messages[0].content as string;
    expect(text).toContain('playing White');
    expect(text).toContain('B E5');
    expect(text).toContain(' 5 . . . . X . . . .');
    expect(text).toContain('fumito: Is my tengen good?');
  });

  it('stays silent on a refusal and skips fallbacks for Haiku', async () => {
    const { client, calls } = fakeClient({ stop_reason: 'refusal', content: [] });
    expect(await new ClaudeChat(client, 'claude-haiku-5-5').reply(ctx)).toBeNull();
    expect(calls[0].fallbacks).toBeUndefined();
  });
});
