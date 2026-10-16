// netlify/functions/shared/db.ts - Production Supabase PostgreSQL Connection Pool & Transactions
import { Pool, PoolClient } from "pg";

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL server configuration missing. Serverless functions require DATABASE_URL.");
    }

    // Supabase PostgreSQL TLS configuration:
    // Support Supabase self-signed CA chain in serverless environment while maintaining TLS encryption
    const sslConfig: { rejectUnauthorized: boolean; ca?: string } = {
      rejectUnauthorized: Boolean(process.env.SUPABASE_SSL_CA)
    };

    if (process.env.SUPABASE_SSL_CA) {
      sslConfig.ca = process.env.SUPABASE_SSL_CA;
    }

    pool = new Pool({
      connectionString,
      ssl: sslConfig,
      max: 5, // Serverless concurrency-safe connection limit
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000
    });
  }
  return pool;
}

/**
 * Executes a callback within a managed PostgreSQL ACID transaction.
 * Automatically issues BEGIN and COMMIT on success, or ROLLBACK on any failure.
 */
export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDbPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
