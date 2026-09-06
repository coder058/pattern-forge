import { loadPublicSnapshot } from "./publicSnapshot.ts";
import type { Interval } from "./marketAnalysis.ts";

// SOURCE: the existing public-market selector and supported intervals.
export const PUBLIC_SYMBOLS = ["BTC", "ETH", "SOL"] as const;
const INTERVALS: Interval[] = ["5m", "30m", "1h", "4h", "1d"];
// GUESS: UNCALIBRATED GUESS — request-sharing window, not a freshness guarantee.
export const SNAPSHOT_CACHE_MS = 30_000;
// GUESS: UNCALIBRATED GUESS — bounded upstream wait, to be tuned from operation.
const UPSTREAM_TIMEOUT_MS = 15_000;
type Snapshot = Awaited<ReturnType<typeof loadPublicSnapshot>>;

/** Fixed upstream and allowlisted markets; never an arbitrary URL proxy.
 * Cache is bounded to the selector's markets and local to one server instance.
 * Concurrent callers share work. Failed requests are never cached as success.
 */
export function createMarketApi(request: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<string, { value: Snapshot; expires: number }>();
  const pending = new Map<string, Promise<Snapshot>>();
  return async (input: Request): Promise<Response> => {
    const symbol = new URL(input.url).pathname.split("/").at(-1) ?? "";
    if (!PUBLIC_SYMBOLS.includes(symbol as typeof PUBLIC_SYMBOLS[number])) {
      return Response.json({ error: "Choose BTC, ETH or SOL." }, { status: 400 });
    }
    const started = now();
    const hit = cache.get(symbol);
    const cached = hit && hit.expires > started ? hit.value : undefined;
    try {
      let value = cached;
      if (!value) {
        let work = pending.get(symbol);
        if (!work) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
          work = loadPublicSnapshot(symbol, INTERVALS, controller.signal, now(), request)
            .then(snapshot => {
              // Partial responses remain visible but retry on the next request.
              if (!Object.keys(snapshot.failures).length) {
                cache.set(symbol, { value: snapshot, expires: now() + SNAPSHOT_CACHE_MS });
              }
              return snapshot;
            })
            .finally(() => { clearTimeout(timer); pending.delete(symbol); });
          pending.set(symbol, work);
        }
        value = await work;
      }
      return Response.json({ ...value, symbol, venue: "Hyperliquid" }, {
        headers: {
          "Cache-Control": "no-store",
          "X-Snapshot-Cache": cached ? "hit" : "miss",
          // SOURCE: measured handler wall time, not exchange or end-to-end latency.
          "Server-Timing": `handler;dur=${Math.max(0, now() - started)}`,
        },
      });
    } catch {
      return Response.json({ error: "Public candles are unavailable. Retry or choose a recording." },
        { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  };
}

export const marketApi = createMarketApi();
