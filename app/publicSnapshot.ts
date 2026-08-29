import { closedPublicCandles } from "./publicMarket.ts";
import { INTERVAL_MS, type Bar, type Interval } from "./marketAnalysis.ts";

// GUESS: UNCALIBRATED GUESS — existing display-history bound, not a trading lookback.
const PUBLIC_BARS = 300;

export async function loadPublicSnapshot(
  symbol: string,
  intervals: Interval[],
  signal: AbortSignal,
  asOf = Date.now(),
  request: typeof fetch = fetch,
) {
  const results = await Promise.allSettled(intervals.map(async (interval) => {
    const response = await request("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "candleSnapshot", req: {
        coin: symbol, interval,
        startTime: asOf - INTERVAL_MS[interval] * PUBLIC_BARS, endTime: asOf,
      } }),
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return closedPublicCandles(await response.json(), asOf, INTERVAL_MS[interval]);
  }));
  const frames: Partial<Record<Interval, Bar[]>> = {};
  const failures: Partial<Record<Interval, string>> = {};
  results.forEach((result, index) => {
    const interval = intervals[index];
    if (result.status === "fulfilled") frames[interval] = result.value;
    else failures[interval] = result.reason instanceof Error ? result.reason.message : "Request failed";
  });
  if (!Object.keys(frames).length) {
    if (signal.aborted) throw signal.reason;
    throw new Error("No public timeframes could be loaded. Try Refresh or choose a recording.");
  }
  return { frames, failures, asOf };
}
