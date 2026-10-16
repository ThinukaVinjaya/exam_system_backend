import pg from 'pg';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

// Parse PostgreSQL NUMERIC/DECIMAL (OID 1700) as JavaScript floating-point numbers
pg.types.setTypeParser(1700, (val: string) => (val === null ? null : parseFloat(val)));

// Parse PostgreSQL BIGINT/INT8 (OID 20) as JavaScript numbers
pg.types.setTypeParser(20, (val: string) => (val === null ? null : parseInt(val, 10)));

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.PG_MAX_POOL_SIZE) || 50,
  min: Number(process.env.PG_MIN_POOL_SIZE) || 0,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  allowExitOnIdle: false,
});

pool.on('error', (err: any) => {
  if (err.code === 'ECONNRESET' || err.message?.includes('Connection terminated')) {
    logger.warn(`Idle connection closed by Supabase pooler: ${err.message}`);
  } else {
    logger.error('Unexpected error on idle PostgreSQL client:', err);
  }
});

export async function query<R extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<R>> {
  const maxRetries = 2;
  let attempt = 0;

  while (true) {
    try {
      const res = await pool.query<R>(text, params);
      return res;
    } catch (err: any) {
      attempt++;
      const isTransient =
        err.message?.includes('Connection terminated') ||
        err.message?.includes('timeout') ||
        err.code === 'ECONNRESET' ||
        err.code === '57P01' ||
        err.code === 'ECONNREFUSED';

      if (isTransient && attempt <= maxRetries) {
        logger.warn(`Retrying transient PostgreSQL connection error (attempt ${attempt}/${maxRetries}): ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
        continue;
      }

      logger.error(`PostgreSQL query error: ${err.message}`, { query: text.slice(0, 100), error: err });
      throw err;
    }
  }
}
