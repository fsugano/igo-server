import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb, migrate } from './db.js';

// Settings such as ANTHROPIC_API_KEY can live in a .env file at the repository root.
try {
  process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'));
} catch {
  // No .env file: use the environment as is.
}

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
