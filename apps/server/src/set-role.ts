/** Grants or removes operator rights: npm run set-role -w @igo/server -- <username> <user|staff|admin> */
import type { Role } from '@igo/shared';
import { loadConfig } from './config.js';
import { createDb, migrate } from './db.js';
import { Users } from './users.js';

const [username, role] = process.argv.slice(2);
const roles: Role[] = ['user', 'staff', 'admin'];
if (!username || !roles.includes(role as Role)) {
  console.error('usage: npm run set-role -w @igo/server -- <username> <user|staff|admin>');
  process.exit(1);
}
const db = createDb(loadConfig().databaseUrl);
await migrate(db);
const u = await new Users(db).setRole(username, role as Role);
console.log(u ? `${u.username}: ${u.role}` : `no such user: ${username}`);
await db.end();
process.exit(u ? 0 : 1);
