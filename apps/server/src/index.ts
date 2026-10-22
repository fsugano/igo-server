import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb, migrate } from './db.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);
await migrate(db);
const { app } = await buildApp(config, db);
await app.listen({ port: config.port, host: config.host });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
