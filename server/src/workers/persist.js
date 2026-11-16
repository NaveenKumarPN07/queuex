import { withTransaction } from '../db.js';

/** Parse raw outbox messages; returns { orders, skipped }. */
export function parseBatch(batch) {
  const orders = [];
  let skipped = 0;
  for (const raw of batch) {
    try {
      const { user_id, item_id } = JSON.parse(raw);
      const userId = Number(user_id);
      const itemId = Number(item_id);
      if (!Number.isInteger(userId) || !Number.isInteger(itemId)) throw new Error('missing ids');
      orders.push({ userId, itemId });
    } catch (err) {
      skipped += 1;
      console.error(`Error parsing order: ${err.message} :: ${raw}`);
    }
  }
  return { orders, skipped };
}

/**
 * Bulk insert + stock deduction in ONE transaction (Django: bulk_create + F('stock_count') - n).
 * ON CONFLICT DO NOTHING makes this idempotent: if a batch is replayed after a crash that
 * happened between COMMIT and the Redis ack, already-saved orders are ignored and, because
 * we count only rows actually inserted, stock is not deducted twice.
 * Returns the number of orders newly inserted.
 */
export async function persistBatch(orders) {
  if (orders.length === 0) return 0;

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO orders (user_id, item_id)
       SELECT * FROM unnest($1::int[], $2::bigint[])
       ON CONFLICT (user_id, item_id) DO NOTHING
       RETURNING item_id`,
      [orders.map((o) => o.userId), orders.map((o) => o.itemId)],
    );

    const deductions = new Map();
    for (const { item_id } of rows) deductions.set(item_id, (deductions.get(item_id) ?? 0) + 1);

    for (const [itemId, sold] of deductions) {
      await client.query('UPDATE inventory_items SET stock_count = stock_count - $1 WHERE id = $2', [sold, itemId]);
    }
    return rows.length;
  });
}
