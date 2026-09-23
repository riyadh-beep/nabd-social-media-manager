import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { assertCoreEnvironment } from "../../config/src/env.js";

const environment = assertCoreEnvironment();

export const database = new Pool({
  connectionString: environment.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export async function databaseReady(): Promise<void> {
  await database.query("select 1");
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("begin");
    const value = await run(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function one<T extends QueryResultRow>(sql: string, parameters: unknown[] = []): Promise<T | null> {
  const result = await database.query<T>(sql, parameters);
  return result.rows[0] ?? null;
}
