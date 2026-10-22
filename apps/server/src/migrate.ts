import { loadConfig } from './config.js';
import { createDb, migrate } from './db.js';

const db = createDb(loadConfig().databaseUrl);
const applied = await migrate(db);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
await db.end();
