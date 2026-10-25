/** Starts the embedded PostgreSQL server and keeps it running until Ctrl+C. */
import { ensurePostgres, parseDbUrl } from './pg.js';

const handle = await ensurePostgres();
const { port, database } = parseDbUrl();
if (!handle.started) {
  console.log(`[explorix] PostgreSQL already running on port ${port} (database "${database}" ensured).`);
  process.exit(0);
}
console.log('[explorix] Press Ctrl+C to stop PostgreSQL.');
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log('\n[explorix] Stopping PostgreSQL...');
  await handle.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
