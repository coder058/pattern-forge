import catalog from "../public/recordings/catalog.json";
import {
  validateBars,
  type Bar,
  type Interval,
} from "./marketAnalysis";

export type MarketSource = {
  id: string;
  symbol: string;
  label: string;
  group: string;
  kind: "public" | "recording" | "case";
  venue: string;
  path?: string;
  count?: number;
  last?: number;
  first?: number;
  gaps?: number;
  sourceSha256?: string;
  note?: string;
};
export type LoadedMarket = {
  id: string;
  frames: Partial<Record<Interval, Bar[]>>;
  asOf: number;
  base?: Interval;
  failures?: Partial<Record<Interval, string>>;
};
export const SOURCES: MarketSource[] = [
  ...["BTC", "ETH", "SOL"].map((symbol) => ({
    id: `public-${symbol}`,
    symbol,
    label: (
      { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana" } as Record<
        string,
        string
      >
    )[symbol],
    group: "Public markets",
    kind: "public" as const,
    venue: "Hyperliquid",
  })),
  ...catalog.map((item) => ({ ...item, kind: "recording" as const })),
  {
    id: "saved-btc",
    symbol: "BTC",
    label: "Saved BTC case",
    group: "Case studies",
    kind: "case",
    venue: "Hyperliquid",
    path: "/demo-market.json",
    note: "28 July 2026: a breakout that failed. Historical case, not an active setup.",
  },
];
export const SOURCE_INTERVALS = (source: MarketSource): Interval[] =>
  source.kind === "recording"
    ? ["1h", "4h", "1d"]
    : source.kind === "case"
      ? ["5m", "30m", "1h", "4h"]
      : ["5m", "30m", "1h", "4h", "1d"];

export async function loadMarket(
  source: MarketSource,
  signal: AbortSignal,
): Promise<LoadedMarket> {
  if (source.kind === "public") {
    const response = await fetch(`/api/markets/${source.symbol}`, { signal });
    if (!response.ok) throw new Error("Public candles are unavailable. Try Refresh or choose a recording.");
    const snapshot = await response.json();
    if (snapshot.symbol !== source.symbol || !Number.isSafeInteger(snapshot.asOf))
      throw new Error("The snapshot does not match the selected market.");
    const frames = Object.fromEntries(SOURCE_INTERVALS(source)
      .filter(interval => snapshot.frames?.[interval])
      .map(interval => [interval, validateBars(snapshot.frames[interval], interval, snapshot.asOf)]));
    if (!Object.keys(frames).length) throw new Error("No closed candles are available.");
    return { id: source.id, frames, asOf: snapshot.asOf, failures: snapshot.failures };
  }
  const response = await fetch(source.path!, { signal });
  if (!response.ok)
    throw new Error("The recording could not be loaded. Try Refresh.");
  const document = await response.json();
  if (source.kind === "recording") {
    const asOf = document.metadata.asOf;
    if (!Number.isSafeInteger(asOf) || document.metadata.id !== source.id)
      throw new Error("Recording metadata does not match the selected market.");
    return {
      id: source.id,
      asOf,
      base: "1h",
      frames: { "1h": validateBars(document.candles, "1h", asOf) },
    };
  }
  const asOf = Date.parse(document.asOf);
  return {
    id: source.id,
    asOf,
    frames: Object.fromEntries(
      SOURCE_INTERVALS(source).map((interval) => [
        interval,
        validateBars(document.timeframes[interval].candles, interval, asOf),
      ]),
    ),
  };
}
