import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';
import { config } from './config.js';

const luaDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lua');
const readLua = (name) => fs.readFileSync(path.join(luaDir, name), 'utf8');

/**
 * ioredis multiplexes (pipelines) commands over one connection, so the
 * BlockingConnectionPool from the Python version isn't needed here.
 * defineCommand() == redis-py's register_script(): EVALSHA with automatic
 * fallback to EVAL if the script isn't cached.
 */
export function createRedis(opts = {}) {
  return new Redis(config.redisUrl, { maxRetriesPerRequest: 3, ...opts });
}

export const redis = createRedis();

redis.defineCommand('inventoryAttempt', { numberOfKeys: 3, lua: readLua('inventory.lua') });
redis.defineCommand('rateLimit', { numberOfKeys: 1, lua: readLua('rate_limiter.lua') });

redis.on('error', (err) => console.error('[redis]', err.message));
