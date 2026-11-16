import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { redis } from './redis.js';

const server = app.listen(config.port, () => {
  console.log(`FlashLock API listening on http://localhost:${config.port}`);
});

// Keep-alive longer than typical proxies/load generators to avoid dropped sockets under load.
server.keepAliveTimeout = 65_000;

async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(async () => {
    await Promise.allSettled([pool.end(), redis.quit()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
