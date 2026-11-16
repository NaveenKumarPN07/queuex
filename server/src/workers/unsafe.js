// "The Error-Prone Worker": BLPOP/LPOP removes messages from Redis *before* Postgres has
// them. If this process dies (or the DB write fails) mid-batch, those orders are lost.
// Kept for demonstration only. Port of error_process_outbox.py.
import { config } from '../config.js';
import { createRedis } from '../redis.js';
import { parseBatch, persistBatch } from './persist.js';

const BATCH_SIZE = 50;
const redis = createRedis({ maxRetriesPerRequest: null });

console.log('UNSAFE worker started. Waiting for orders...');

while (true) {
  const popped = await redis.blpop(config.keys.outbox, 0);
  const pipe = redis.pipeline();
  for (let i = 0; i < BATCH_SIZE - 1; i++) pipe.lpop(config.keys.outbox);
  const extra = (await pipe.exec()).map(([, v]) => v).filter(Boolean);
  const batch = [popped[1], ...extra];

  try {
    const inserted = await persistBatch(parseBatch(batch).orders);
    console.log(`Processed batch of ${inserted} orders`);
  } catch (err) {
    console.error(`Database error processing batch (these ${batch.length} orders are now LOST): ${err.message}`);
  }
}
