import { INTERVAL_MS, type Bar, type Interval } from "./marketAnalysis.ts";

/** Intervals the ingester persists by default. */
export const STORED_INTERVALS: Interval[] = ["1h", "4h", "1d"];
// GUESS: UNCALIBRATED GUESS — read bound per interval, matching the existing
// display history in app/publicSnapshot.ts. Not a trading lookback.
export const STORED_BARS = 300;

/** One round trip for every interval: rank each interval's rows, keep the newest.
 * The primary key already prevents duplicate candles, so no grouping is needed here.
 */
export const STORED_QUERY = `
SELECT interval, open_time, close_time, "open", "high", "low", "close", volume
  FROM (
    SELECT interval, open_time, close_time, "open", "high", "low", "close", volume,
           row_number() OVER (PARTITION BY interval ORDER BY open_time DESC) AS position
      FROM candles
     WHERE symbol = $1 AND interval = ANY($2)
  ) ranked
 WHERE position <= $3
 ORDER BY interval, open_time
`;

export type StoredRow = Record<string, unknown>;

/** node-postgres returns bigint columns as strings, so widen then check the range. */
function epochMilliseconds(value: unknown) {
  const result = typeof value === "string" ? Number(value) : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0)
    throw new Error("Stored candle has an unusable timestamp.");
  return result;
}

function price(value: unknown) {
  const result = typeof value === "string" ? Number(value) : value;
  if (typeof result !== "number" || !Number.isFinite(result))
    throw new Error("Stored candle has an unusable price or volume.");
  return result;
}

/** Group stored rows into per-interval frames without trusting the row contents.
 * A stored row still has to describe a whole candle of its interval; anything
 * else is a storage fault and is reported rather than charted.
 */
export function toFrames(rows: Iterable<StoredRow>) {
  const frames: Partial<Record<Interval, Bar[]>> = {};
  const byInterval = new Map<Interval, Map<number, Bar>>();
  let asOf = 0;
  for (const row of rows) {
    const interval = row.interval as Interval;
    if (!STORED_INTERVALS.includes(interval)) continue;
    const t = epochMilliseconds(row.open_time);
    const closeTime = epochMilliseconds(row.close_time);
    if (closeTime !== t + INTERVAL_MS[interval])
      throw new Error("Stored candle does not span its interval.");
    const o = price(row.open), h = price(row.high), l = price(row.low);
    const c = price(row.close), v = price(row.volume);
    if (l <= 0 || h < Math.max(o, c, l) || l > Math.min(o, c) || v < 0)
      throw new Error("Stored candle has inconsistent bounds.");
    // Only closed candles are ever persisted, so a stored row is closed by construction.
    const bar: Bar = { t, closeTime, o, h, l, c, v, closed: true };
    if (!byInterval.has(interval)) byInterval.set(interval, new Map());
    byInterval.get(interval)!.set(t, bar);
    if (closeTime > asOf) asOf = closeTime;
  }
  const counts: Partial<Record<Interval, number>> = {};
  for (const [interval, bars] of byInterval) {
    frames[interval] = [...bars.values()].sort((a, b) => a.t - b.t);
    counts[interval] = frames[interval]!.length;
  }
  // The cutoff is the newest stored close, so a restart replays what is on disk
  // rather than assuming the ingester is currently running.
  return { frames, counts, asOf };
}
