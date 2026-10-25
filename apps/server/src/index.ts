import { createApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { bootstrapIfEmpty } from './lib/bootstrap.js';
import { logger } from './logger.js';

async function waitForDatabase(attempts = 30) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      if (i === attempts) throw err;
      logger.warn(`Database not ready (attempt ${i}/${attempts}); retrying in 2s`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

await waitForDatabase();
await bootstrapIfEmpty();
const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info(`Explorix API listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
});

// Periodically purge expired login sessions.
setInterval(() => {
  prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
}, 60 * 60_000).unref();

const shutdown = () => {
  server.close(() => void prisma.$disconnect().then(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
