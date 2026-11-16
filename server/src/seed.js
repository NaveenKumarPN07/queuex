// Replaces the manual steps in the Django README (shell seed + redis-cli FLUSHALL / SET 1 10000).
// Usage: npm run seed -- [stock]   (default 10000)
import { config } from './config.js';
import { pool } from './db.js';
import { redis } from './redis.js';

const stock = Number.parseInt(process.argv[2] ?? '10000', 10);

try {
  await pool.query('TRUNCATE orders, inventory_items RESTART IDENTITY CASCADE');
  const { rows } = await pool.query(
    'INSERT INTO inventory_items (name, stock_count) VALUES ($1, $2) RETURNING id',
    ['Limited Edition Sneaker', stock],
  );
  const itemId = rows[0].id;

  // Reset only FlashLock's keys rather than FLUSHALL.
  const stale = [String(itemId), `purchased:${itemId}`, config.keys.outbox, config.keys.processing];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'rate_limit:*', 'COUNT', 1000);
    cursor = next;
    stale.push(...keys);
  } while (cursor !== '0');
  await redis.del(...stale);

  await redis.set(String(itemId), stock);
  console.log(`Seeded item ${itemId} with stock ${stock} in Postgres and Redis.`);
} finally {
  await pool.end();
  await redis.quit();
}
