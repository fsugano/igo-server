export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** Directory of the built web client to serve, if any. */
  webDist: string | null;
  secureCookies: boolean;
  sessionDays: number;
  /**
   * Which proxies may set X-Forwarded-For (Fastify's trustProxy).
   * Off by default: otherwise anyone could send the header and dodge the per-IP limits on login and sign-up.
   */
  trustProxy: boolean | number | string;
  /** Browser origins allowed to open the realtime connection. Empty: only the server's own origin. */
  allowedOrigins: string[];
}

export function loadConfig(env = process.env): Config {
  const production = env.NODE_ENV === 'production';
  if (production && !env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set when NODE_ENV=production (the default database password is not for production)');
  }
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '127.0.0.1',
    databaseUrl: env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/igo',
    webDist: env.WEB_DIST ?? null,
    secureCookies: production,
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
  };
}

/** "true" (any proxy: only behind a proxy that overwrites the header), a hop count such as "1", or a list of proxy IPs/CIDRs. */
export function parseTrustProxy(v: string | undefined): boolean | number | string {
  if (!v || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}
