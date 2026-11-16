// "The Perfect Worker": batched, crash-resilient outbox relay (Redis -> Postgres).
// Replaces BLMOVE_process_outbox.py and process_outbox.py (BRPOPLPUSH is deprecated in
// Redis 6.2+ in favour of BLMOVE, so the two collapse into this one).
//
// Run ONE instance only (see recovery note below).
import { config } from '../config.js';
import { pool } from '../db.js';
import { createRedis } from '../redis.js';
import { parseBatch, persistBatch } from './persist.js';

const { outbox, processing } = config.keys;
const BATCH_SIZE = 50;

// Blocking commands monopolise a connection, so the worker owns its own.
const redis = createRedis({ maxRetriesPerRequest: null });
let running = true;

/**
 * Crash recovery. Anything still in the processing list at startup was claimed by a
 * previous run that died before acking. Move it back to the outbox. This is safe to
 * replay because persistBatch() is idempotent.
 */
async function recoverStranded() {
  let moved = 0;
  while (await redis.lmove(processing, outbox, 'LEFT', 'RIGHT')) moved += 1;
  if (moved) console.log(`Recovered ${moved} unacknowledged orders from ${processing}.`);
}

async function main() {
  console.log('Reliable worker started. Waiting for orders...');
  await recoverStranded();

  while (running) {
    // 1. Block until at least one order exists, atomically claiming it.
    const first = await redis.blmove(outbox, processing, 'RIGHT', 'LEFT', 1); // 1s so we can notice SIGINT
    if (!first) continue;

    // 2. Fast gather: claim the rest of the batch in a single round trip.
    const pipe = redis.pipeline();
    for (let i = 0; i < BATCH_SIZE - 1; i++) pipe.lmove(outbox, processing, 'RIGHT', 'LEFT');
    const extra = (await pipe.exec()).map(([, v]) => v).filter(Boolean);
    const batch = [first, ...extra];

    // 3 + 4. Persist atomically.
    try {
      const { orders, skipped } = parseBatch(batch);
      const inserted = await persistBatch(orders);

      // 5. Ack: only reached if the Postgres transaction committed.
      const ack = redis.pipeline();
      for (const raw of batch) ack.lrem(processing, 1, raw);
      await ack.exec();

      console.log(`Processed batch of ${batch.length}: ${inserted} inserted, ${orders.length - inserted} already present, ${skipped} invalid.`);
    } catch (err) {
      // Messages stay in `processing`; they're replayed on the next restart.
      console.error(`Database error during batch save: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000)); // back off instead of hot-looping on a down DB
    }
  }
}

async function stop() {
  running = false;
  setTimeout(async () => {
    await Promise.allSettled([pool.end(), redis.quit()]);
    process.exit(0);
  }, 1500).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
