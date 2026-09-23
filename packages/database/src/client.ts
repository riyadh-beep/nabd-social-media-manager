YªçŠx-®éÜj×¢ëiºÚ+Š§j[h‘éÜ¢éíßS¢Ö¥¢ëiºÙbë5import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { assertCoreEnvironment } from "../../config/src/env.js";

const environment =Ûm¢G§²ÚîÆ­yÙng, parameters: unknown[] = []): Promise<T | null> {
  const result = await database.query<T>(sql, parameters);
  return result.rows[0] ?? null;
}
