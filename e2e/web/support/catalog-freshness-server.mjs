// Owned loopback server: never seed identities, borrow listeners, or launch native apps.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from '../../../packages/server/dist/index.js';
const dbPath = resolve('packages/server/data/local.db');
if (!existsSync(dbPath) || resolve(process.env.DATABASE_URL ?? '') !== dbPath)
  throw new Error('Prepare the synthetic freshness fixture in this checkout first');
const server = await createServer({
  dbPath,
  seedData: false,
  host: '127.0.0.1',
  port: Number(process.env.PUNTOVIVO_BIND_PORT),
  verbose: false,
});
let closing = false;
async function shutdown() {
  if (!closing) {
    closing = true;
    await server.close();
  }
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
await server.listen();
