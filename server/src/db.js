import pg from 'pg';
import { config } from './config.js';

// BIGINT (oid 20) / COUNT come back as strings by default; ids here fit in a JS number.
pg.types.setTypeParser(20, Number);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.pgPoolMax,
});

/** Run fn(client) inside BEGIN/COMMIT, rolling back on error. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
