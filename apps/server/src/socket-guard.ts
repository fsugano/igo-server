import type { IncomingMessage } from 'node:http';

/**
 * Checks the Origin of a browser opening the realtime connection (protection against cross-site WebSocket hijacking:
 * the connection is authenticated by cookie, so another site must not be able to open it in the user's name).
 * Requests without an Origin come from programs, not browsers, and carry no one else's cookie: they are let through.
 */
export function originAllowed(req: Pick<IncomingMessage, 'headers'>, allowed: string[], production: boolean): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (allowed.length) return allowed.includes(url.origin);
  // Same host as the page was served from (directly, or through the Vite dev proxy).
  if (url.host === req.headers.host) return true;
  // While developing, any page on this computer.
  return !production && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

/** Per-key limits for Socket.IO events: at most `max` events per `windowMs` in each group. */
export class EventLimiter {
  private hits = new Map<string, number[]>();

  constructor(private now: () => number = Date.now) {}

  /** True if the event may go ahead (and counts it). */
  allow(key: string, event: string): boolean {
    const rule = ruleFor(event);
    if (!rule) return true;
    const k = `${key}|${rule.group}`;
    const t = this.now();
    const list = (this.hits.get(k) ?? []).filter((x) => t - x < rule.windowMs);
    if (list.length >= rule.max) {
      this.hits.set(k, list);
      return false;
    }
    list.push(t);
    this.hits.set(k, list);
    return true;
  }

  /** Forgets a key (e.g. when its socket disconnects). */
  forget(key: string) {
    for (const k of this.hits.keys()) if (k.startsWith(`${key}|`)) this.hits.delete(k);
  }
}

interface Rule {
  group: string;
  max: number;
  windowMs: number;
}

const RULES: [RegExp, Rule][] = [
  [/^game:chat$/, { group: 'chat', max: 3, windowMs: 5_000 }],
  [/^(seek:create|seek:cancel|seek:accept|ai:start)$/, { group: 'match', max: 10, windowMs: 60_000 }],
  [/^game:(move|pass|resign|toggleDead|acceptScore|resume)$/, { group: 'play', max: 20, windowMs: 5_000 }],
  [/^(lobby:join|game:join|gauge:watch|ai:engines)$/, { group: 'join', max: 30, windowMs: 10_000 }],
];

function ruleFor(event: string): Rule | null {
  for (const [re, rule] of RULES) if (re.test(event)) return rule;
  return null;
}
