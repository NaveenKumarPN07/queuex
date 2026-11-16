// "The Slow Worker": one Postgres transaction (with a row lock) per order.
// Demonstrates the cost of not batching. Port of slow_process_outbox.py.
import { config } from '../config.js';
import { withTransaction } from '../db.js';
import { createRedis } from '../redis.js';

const redis = createRedis({ maxRetriesPerRequest: null });
console.log('SLOW worker started. Waiting for orders...');

while (true) {
  const [, data] = await redis.blpop(config.keys.outbox, 0);
  let order;
  try {
    order = JSON.parse(data);
    const userId = Number(order.user_id);
    const itemId = Number(order.item_id);
    if (!Number.isInteger(userId) || !Number.isInteger(itemId)) throw new Error('Invalid order data, missing user_id or item_id');

    await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT stock_count FROM inventory_items WHERE id = $1 FOR UPDATE', [itemId]);
      if (rows.length === 0) return console.log(`Item ${itemId} does not exist, cannot process order for user ${userId}`);
      if (rows[0].stock_count <= 0) return console.log(`Not enough stock for item ${itemId} to process order for user ${userId}`);

      await client.query('UPDATE inventory_items SET stock_count = stock_count - 1 WHERE id = $1', [itemId]);
      await client.query('INSERT INTO orders (user_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, itemId]);
      console.log(`Processed order for user ${userId} and item ${itemId}`);
    });
  } catch (err) {
    console.error(`Error processing order ${data}: ${err.message}`);
  }
}
