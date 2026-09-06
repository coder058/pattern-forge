import { Pool } from "pg";
import type { CandleQuery } from "./storedApi.ts";

// GUESS: UNCALIBRATED GUESS — small pool and bounded waits for a single
// container. Not measured capacity.
const POOL_SIZE = 4;
const CONNECT_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 30_000;

let pool: Pool | undefined;

/** Created on first use, so a build or a page render without DATABASE_URL still works. */
function candlePool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  pool ??= new Pool({
    connectionString,
    max: POOL_SIZE,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
  });
  return pool;
}

export const candleQuery: CandleQuery = async (text, values) =>
  (await candlePool().query(text, values)).rows;

/** Release the pool so a one-shot script can exit. Not used by the server. */
export async function closeCandlePool() {
  const open = pool;
  pool = undefined;
  await open?.end();
}
