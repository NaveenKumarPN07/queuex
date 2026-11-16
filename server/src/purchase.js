import { config } from './config.js';
import { redis } from './redis.js';

export const Result = Object.freeze({
  OK: 1,
  SOLD_OUT: 0,
  DUPLICATE: -1,
  REDIS_ERROR: -2,
  RATE_LIMITED: -3,
});

/**
 * Hot path: token-bucket rate limit, then atomic check-and-decrement + outbox push,
 * both as Lua scripts so Redis executes each one without interleaving.
 */
export async function attemptPurchase(userId, itemId, timestamp) {
  try {
    const { capacity, refillRate, refillInterval } = config.rateLimit;
    const now = Date.now() / 1000;

    const allowed = await redis.rateLimit(`rate_limit:${userId}`, capacity, refillRate, refillInterval, now, 1);
    if (allowed === 0) return Result.RATE_LIMITED;

    return await redis.inventoryAttempt(
      String(itemId), // stock counter key (same key scheme as the Django version)
      `purchased:${itemId}`, // set of user ids that already bought
      config.keys.outbox, // transactional outbox list
      userId,
      timestamp,
    );
  } catch (err) {
    console.error('Redis error:', err.message);
    return Result.REDIS_ERROR;
  }
}
