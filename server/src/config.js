import 'dotenv/config';

const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

export const config = {
  port: int(process.env.PORT, 8000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/flashlock',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  pgPoolMax: int(process.env.PG_POOL_MAX, 20),
  rateLimit: {
    capacity: int(process.env.RATE_LIMIT_CAPACITY, 5),
    refillRate: int(process.env.RATE_LIMIT_REFILL_RATE, 20),
    refillInterval: int(process.env.RATE_LIMIT_REFILL_INTERVAL, 60),
  },
  simulatedDelayMs: int(process.env.SIMULATED_DELAY_MS, 500),
  keys: {
    outbox: 'orders_queue',
    processing: 'processing_queue',
  },
};
