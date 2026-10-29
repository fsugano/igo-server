import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { BUILTIN_LEVELS, BuiltinEngine } from './builtin.js';
import type { Engine } from './engine.js';
import { GtpEngine } from './gtp.js';

export type { Engine, EngineMove } from './engine.js';

// Bot names contain "-", which human usernames cannot, so they never collide.
const gtpSchema = z.array(
  z.object({
    id: z.string().regex(/^[a-z0-9_-]{1,24}$/),
    name: z.string().regex(/^[A-Za-z0-9_]{1,13}$/),
    label: z.string().max(40).optional(),
    rank: z.string().regex(/^([1-9]|[12][0-9]|30)k$|^[1-9]d$/i).default('1d'),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    cwd: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
);

/**
 * The built-in levels plus any GTP engines configured in AI_GTP_ENGINES: a JSON array, or the path of a file holding one, e.g.
 * [{"id":"katago","name":"KataGo","rank":"9d","command":"C:/katago/katago.exe","args":["gtp","-model","model.bin.gz","-config","gtp.cfg"]}]
 */
export function loadEngines(env: NodeJS.ProcessEnv = process.env): Engine[] {
  const engines: Engine[] = BUILTIN_LEVELS.map((l) => new BuiltinEngine(l));
  if (env.AI_GTP_ENGINES) {
    const raw = env.AI_GTP_ENGINES.trim();
    const cfgs = gtpSchema.parse(JSON.parse(raw.startsWith('[') ? raw : readFileSync(raw, 'utf8')));
    for (const c of cfgs) {
      engines.push(
        new GtpEngine({
          ...c,
          id: `gtp-${c.id}`,
          username: `AI-${c.name}`,
          label: c.label ?? c.name,
        }),
      );
    }
  }
  return engines;
}
