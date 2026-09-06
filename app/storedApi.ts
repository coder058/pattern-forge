import { PUBLIC_SYMBOLS } from "./marketApi.ts";
import { STORED_BARS, STORED_INTERVALS, STORED_QUERY, toFrames, type StoredRow } from "./storedMarket.ts";

export type CandleQuery = (text: string, values: unknown[]) => Promise<StoredRow[]>;

/** Read persisted candles for one allowlisted market.
 * An empty store is a normal state before the ingester has run, so it answers
 * 404 with an instruction rather than pretending the database is broken.
 */
export function createStoredApi(query: CandleQuery, now = Date.now) {
  return async (input: Request): Promise<Response> => {
    const symbol = new URL(input.url).pathname.split("/").at(-1) ?? "";
    if (!PUBLIC_SYMBOLS.includes(symbol as typeof PUBLIC_SYMBOLS[number])) {
      return Response.json({ error: "Choose BTC, ETH or SOL." }, { status: 400 });
    }
    const started = now();
    try {
      const rows = await query(STORED_QUERY, [symbol, STORED_INTERVALS, STORED_BARS]);
      const { frames, counts, asOf } = toFrames(rows);
      if (!Object.keys(frames).length) {
        return Response.json(
          { error: "No candles are stored for this market yet. Run the ingester, then reload." },
          { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      return Response.json({ ...{ frames, asOf }, symbol, venue: "Hyperliquid", stored: counts, source: "database" }, {
        headers: {
          "Cache-Control": "no-store",
          // SOURCE: measured query and mapping wall time inside this handler.
          // Not database server time, network time or end-to-end latency.
          "Server-Timing": `query;dur=${Math.max(0, now() - started)}`,
        },
      });
    } catch {
      return Response.json({ error: "Stored candles are unavailable. Check the database connection." },
        { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  };
}
