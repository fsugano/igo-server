import { describe, expect, it } from 'vitest';
import { loadConfig, parseTrustProxy } from '../src/config.js';
import { EventLimiter, originAllowed } from '../src/socket-guard.js';

const req = (origin: string | undefined, host = 'igo.example') => ({ headers: { origin, host } });

describe('origin check', () => {
  it('allows the same site and programs without an origin', () => {
    expect(originAllowed(req(undefined), [], true)).toBe(true);
    expect(originAllowed(req('https://igo.example'), [], true)).toBe(true);
    expect(originAllowed(req('https://evil.example'), [], true)).toBe(false);
    expect(originAllowed(req('not a url'), [], true)).toBe(false);
  });

  it('allows this computer only while developing', () => {
    expect(originAllowed(req('http://localhost:5173', '127.0.0.1:3000'), [], false)).toBe(true);
    expect(originAllowed(req('http://localhost:5173', '127.0.0.1:3000'), [], true)).toBe(false);
  });

  it('uses the configured list when there is one', () => {
    const list = ['https://igo.example', 'https://app.igo.example'];
    expect(originAllowed(req('https://app.igo.example', 'api.igo.example'), list, true)).toBe(true);
    expect(originAllowed(req('https://igo.example.evil.com', 'api.igo.example'), list, true)).toBe(false);
  });
});

describe('event limits', () => {
  it('limits each group per key and forgets old events', () => {
    let t = 0;
    const l = new EventLimiter(() => t);
    expect([1, 2, 3, 4].map(() => l.allow('u1', 'game:chat'))).toEqual([true, true, true, false]);
    // Other keys and other groups are separate; unlisted events are free.
    expect(l.allow('u2', 'game:chat')).toBe(true);
    expect(l.allow('u1', 'game:move')).toBe(true);
    expect(l.allow('u1', 'lobby:leave')).toBe(true);
    t = 5_000;
    expect(l.allow('u1', 'game:chat')).toBe(true);
  });
});

describe('config', () => {
  it('trusts no proxy unless told to', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(loadConfig({}).trustProxy).toBe(false);
  });

  it('needs a database address in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', ALLOWED_ORIGINS: 'https://a.example/, https://b.example' }).allowedOrigins).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
});
