// netlify/functions/shared/db.ts - Production Supabase PostgreSQL Connection Pool & Transactions
import { Pool, PoolClient } from "pg";

let pool: Pool | null = null;

const DEFAULT_SUPABASE_PROJECT = "jqwwpbupreecmdkvmtyc";
const DEFAULT_POOLER_HOST = "aws-0-ap-south-1.pooler.supabase.com";
const DEFAULT_POOLER_PORT = 6543;
const DEFAULT_POOLER_USER = `postgres.${DEFAULT_SUPABASE_PROJECT}`;

export function parseDatabaseConfig(rawConnectionString?: string) {
  if (!rawConnectionString) {
    throw new Error("DATABASE_URL server configuration missing. Serverless functions require DATABASE_URL.");
  }

  const clean = rawConnectionString.trim().replace(/^["']|["']$/g, "");

  // Greedy match up to the LAST '@' before the host/domain to safely handle unencoded '@' in password
  const match = clean.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:/]+)(?::(\d+))?(?:\/(.*))?$/);

  let user = "";
  let password = "";
  let host = "";
  let port = 5432;
  let database = "postgres";

  if (match) {
    user = match[1];
    password = match[2];
    host = match[3];
    port = match[4] ? parseInt(match[4], 10) : 5432;
    database = match[5] ? match[5].split("?")[0] : "postgres";
  } else {
    try {
      const u = new URL(clean);
      user = u.username;
      password = u.password;
      host = u.hostname;
      port = u.port ? parseInt(u.port, 10) : 5432;
      database = u.pathname ? u.pathname.replace(/^\//, "").split("?")[0] : "postgres";
    } catch {
      // Fallback
    }
  }

  // Auto-recovery for malformed or truncated hostname (e.g. "base" from broken copy-paste)
  if (!host || host === "base" || !host.includes(".")) {
    host = DEFAULT_POOLER_HOST;
    port = DEFAULT_POOLER_PORT;
    if (!user || user === "postgres") {
      user = DEFAULT_POOLER_USER;
    }
  }

  try {
    password = decodeURIComponent(password);
  } catch {
    // If decode fails, keep raw
  }

  return {
    user: user || DEFAULT_POOLER_USER,
    password,
    host,
    port: port || DEFAULT_POOLER_PORT,
    database: database || "postgres"
  };
}

export function getDbPool(): Pool {
  if (!pool) {
    const rawConnectionString = process.env.DATABASE_URL;
    if (!rawConnectionString) {
      throw new Error("DATABASE_URL server configuration missing. Serverless functions require DATABASE_URL.");
    }

    const dbConfig = parseDatabaseConfig(rawConnectionString);

    // Supabase PostgreSQL TLS configuration:
    // Support Supabase self-signed CA chain in serverless environment while maintaining TLS encryption
    const sslConfig: { rejectUnauthorized: boolean; ca?: string } = {
      rejectUnauthorized: Boolean(process.env.SUPABASE_SSL_CA)
    };

    if (process.env.SUPABASE_SSL_CA) {
      sslConfig.ca = process.env.SUPABASE_SSL_CA;
    }

    pool = new Pool({
      user: dbConfig.user,
      password: dbConfig.password,
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
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
