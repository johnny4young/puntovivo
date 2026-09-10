// Test-owned empty installation, never the operator's shared or packaged DB.
// The private capability travels only over the parent/child IPC channel.
import { createServer } from '../../packages/server/dist/index.js';

const server = await createServer({
  dbPath: process.argv[2],
  seedData: false,
  port: 0,
  host: '127.0.0.1',
  verbose: false,
});
await server.listen();
process.send?.({ type: 'ready', url: server.getUrl(), token: server.getSetupToken() });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  process.disconnect?.();
}
process.on('message', message => {
  if (message === 'close') void close();
});
process.on('SIGTERM', () => {
  void close();
});
