export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** Directory of the built web client to serve, if any. */
  webDist: string | null;
  secureCookies: boolean;
  sessionDays: number;
}

export function loadConfig(env = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/igo',
    webDist: env.WEB_DIST ?? null,
    secureCookies: env.NODE_ENV === 'production',
    sessionDays: Number(env.SESSION_DAYS ?? 30),
  };
}
