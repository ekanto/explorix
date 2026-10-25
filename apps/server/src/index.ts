import { startServer } from './server.js';

const server = await startServer();

const shutdown = () => {
  void server.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
