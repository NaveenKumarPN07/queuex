import { Router } from 'express';
import { config } from './config.js';
import { pool, withTransaction } from './db.js';
import { redis } from './redis.js';
import { attemptPurchase, Result } from './purchase.js';

const router = Router();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isId = (v) => Number.isInteger(v) && v > 0 && v <= 2147483647;
const fail = (res, status, message, kind = 'error') => res.status(status).json({ status: kind, message });

/** Pulls and validates { user_id, item_id }. Returns null (after responding) on bad input. */
function readIds(req, res) {
  const { user_id: userId, item_id: itemId } = req.body ?? {};
  if (userId === undefined || userId === null || itemId === undefined || itemId === null) {
    fail(res, 400, 'User ID and Item ID are required');
    return null;
  }
  if (!isId(userId) || !isId(itemId)) {
    fail(res, 400, 'User ID and Item ID must be positive integers');
    return null;
  }
  return { userId, itemId };
}

// ---------------------------------------------------------------------------
// 1. NAIVE (intentionally broken): read-check-write with no lock -> oversells.
// ---------------------------------------------------------------------------
router.post('/purchase_naive_wrong', async (req, res) => {
  const ids = readIds(req, res);
  if (!ids) return;
  const { userId, itemId } = ids;

  const existing = await pool.query('SELECT 1 FROM orders WHERE user_id = $1 AND item_id = $2', [userId, itemId]);
  if (existing.rowCount > 0) return fail(res, 400, 'User has already purchased this item');

  const { rows } = await pool.query('SELECT stock_count FROM inventory_items WHERE id = $1', [itemId]);
  if (rows.length === 0) return fail(res, 404, 'Item not found');
  if (rows[0].stock_count <= 0) return fail(res, 400, 'Not enough stock');

  await sleep(config.simulatedDelayMs); // widens the race window, as in the original
  // Writes back a value computed from the stale read -> the "lost update" anomaly.
  await pool.query('UPDATE inventory_items SET stock_count = $1 WHERE id = $2', [rows[0].stock_count - 1, itemId]);
  await pool.query('INSERT INTO orders (user_id, item_id) VALUES ($1, $2)', [userId, itemId]);
  res.json({ status: 'success', message: 'Purchase successful' });
});

// ---------------------------------------------------------------------------
// 2. TRANSACTIONAL: correct, but SELECT ... FOR UPDATE serialises every request.
// ---------------------------------------------------------------------------
router.post('/purchase_transactional', async (req, res) => {
  const ids = readIds(req, res);
  if (!ids) return;
  const { userId, itemId } = ids;

  try {
    const existing = await pool.query('SELECT 1 FROM orders WHERE user_id = $1 AND item_id = $2', [userId, itemId]);
    if (existing.rowCount > 0) return fail(res, 400, 'User has already purchased this item');

    const outcome = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT stock_count FROM inventory_items WHERE id = $1 FOR UPDATE', [itemId]);
      if (rows.length === 0) return 'missing';
      if (rows[0].stock_count <= 0) return 'sold_out';

      await sleep(config.simulatedDelayMs);
      await client.query('UPDATE inventory_items SET stock_count = stock_count - 1 WHERE id = $1', [itemId]);
      await client.query('INSERT INTO orders (user_id, item_id) VALUES ($1, $2)', [userId, itemId]);
      return 'ok';
    });

    if (outcome === 'missing') return fail(res, 404, 'Item not found');
    if (outcome === 'sold_out') return fail(res, 400, 'Not enough stock');
    res.json({ status: 'success', message: 'Purchase successful' });
  } catch (err) {
    // Unique violation = same user raced themselves past the pre-check
    if (err.code === '23505') return fail(res, 400, 'User has already purchased this item');
    console.error(err);
    fail(res, 500, err.message);
  }
});

// ---------------------------------------------------------------------------
// 3. HIGH SPEED: Redis Lua decides; Postgres is updated later by the outbox worker.
// ---------------------------------------------------------------------------
router.post('/purchase_high_speed', async (req, res) => {
  const ids = readIds(req, res);
  if (!ids) return;

  const result = await attemptPurchase(ids.userId, ids.itemId, String(Date.now() / 1000));

  switch (result) {
    case Result.OK:
      return res.json({ status: 'success', message: 'Purchase successful' });
    case Result.DUPLICATE:
      return fail(res, 409, 'User already purchased this item', 'duplicate');
    case Result.SOLD_OUT:
      return fail(res, 400, 'Sold Out', 'failed');
    case Result.RATE_LIMITED:
      return fail(res, 429, 'Rate limit exceeded');
    default:
      return fail(res, 500, 'Redis error occurred');
  }
});

// ---------------------------------------------------------------------------
// Read endpoints used by the React client (not in the original project).
// ---------------------------------------------------------------------------
router.get('/items/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!isId(id)) return fail(res, 400, 'Invalid item id');

  const [{ rows }, liveStock, queued] = await Promise.all([
    pool.query('SELECT id, name, stock_count FROM inventory_items WHERE id = $1', [id]),
    redis.get(String(id)),
    redis.llen(config.keys.outbox),
  ]);
  if (rows.length === 0) return fail(res, 404, 'Item not found');

  res.json({
    id: rows[0].id,
    name: rows[0].name,
    redis_stock: liveStock === null ? null : Number(liveStock), // authoritative during the sale
    db_stock: rows[0].stock_count, // eventually consistent
    outbox_pending: queued,
  });
});

router.get('/health', async (_req, res) => {
  const [db, cache] = await Promise.allSettled([pool.query('SELECT 1'), redis.ping()]);
  const ok = db.status === 'fulfilled' && cache.status === 'fulfilled';
  res.status(ok ? 200 : 503).json({ postgres: db.status === 'fulfilled', redis: cache.status === 'fulfilled' });
});

export default router;
