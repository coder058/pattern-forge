import { calculateChart, ema, type Bar } from "./marketAnalysis.ts";

/**
 * A deliberately pessimistic, no-hindsight backtest for the shapes Pattern Forge marks.
 *
 * - A signal is known only at the close of its candle; entry is the next candle's open.
 * - Stop and target are checked with each candle's high/low. If one candle touches both,
 *   the stop is assumed to fill first (the worse outcome).
 * - Costs (fee + slippage, per side) are subtracted from every trade.
 * - No trade starts on, or right after, a flat candle (high = low: no observed trading),
 *   and no trade spans a gap in the data; a gap closes the trade at the last real close.
 * - One position at a time per market.
 */

export type Side = 1 | -1;
export const TRADED_PATTERNS = ["Bullish engulfing", "Bearish engulfing", "Hammer shape", "Shooting-star shape"] as const;
export type TradedPattern = (typeof TRADED_PATTERNS)[number];
export type Signal = TradedPattern | "EMA cross";
export type Mode = "follow" | "fade";
export type Filter = "none" | "trend" | "extreme";
export type Exit =
  | { kind: "hold"; bars: number }
  | { kind: "atr"; stop: number; target: number; maxBars: number };
export type Strategy = { signal: Signal; mode: Mode; filter: Filter; exit: Exit };
export type Costs = { feeBps: number; slippageBps: number };
export type ExitReason = "stop" | "target" | "time" | "gap" | "end";
export type Trade = {
  signalTime: number;
  entryTime: number;
  exitTime: number;
  side: Side;
  entry: number;
  exit: number;
  grossBps: number;
  netBps: number;
  reason: ExitReason;
};
export type Stats = {
  trades: number;
  winRate: number;
  meanBps: number;
  medianBps: number;
  stdBps: number;
  tStat: number;
  profitFactor: number;
  totalBps: number;
  maxDrawdownBps: number;
};

// SOURCE: conventional Wilder ATR and the app's display EMA periods; not tuned.
export const ATR_PERIOD = 14;
const FAST = 20;
const SLOW = 50;
// GUESS: UNCALIBRATED GUESS — conservative taker fee plus slippage per side for thin
// perpetual-contract books. Results are also reported at 0 and at double this cost.
export const DEFAULT_COSTS: Costs = { feeBps: 5, slippageBps: 3 };

const flat = (b: Bar | undefined) => !b || b.h === b.l;
const contiguous = (a: Bar, b: Bar) => a.closeTime === b.t;

export const PATTERN_SIDE: Record<TradedPattern, Side> = {
  "Bullish engulfing": 1,
  "Hammer shape": 1,
  "Bearish engulfing": -1,
  "Shooting-star shape": -1,
};

// GUESS: UNCALIBRATED GUESS — an hourly print more than 20% away from its neighbours'
// median close is treated as a bad print (one recording starts at another market's price;
// isolated wicks to round numbers revert within the hour). Real moves rarely do this.
export const BAD_PRINT_SHARE = 0.2;
const NEIGHBOURS = 3;

/**
 * Drop isolated bad prints: a candle whose open, high, low or close lies more than
 * BAD_PRINT_SHARE from the median close of up to three candles on each side. Dropped
 * candles become gaps, so no signal or trade uses them. This looks at later candles,
 * so it is a data-cleaning step for recorded history, never part of a live signal.
 */
export function dropBadPrints(bars: Bar[], share = BAD_PRINT_SHARE): { bars: Bar[]; dropped: Bar[] } {
  const kept: Bar[] = [];
  const dropped: Bar[] = [];
  bars.forEach((bar, i) => {
    const around = [...bars.slice(Math.max(0, i - NEIGHBOURS), i), ...bars.slice(i + 1, i + 1 + NEIGHBOURS)]
      .map((b) => b.c).sort((a, b) => a - b);
    if (!around.length) { kept.push(bar); return; }
    const mid = around.length % 2 ? around[(around.length - 1) / 2] : (around[around.length / 2 - 1] + around[around.length / 2]) / 2;
    const bad = [bar.o, bar.h, bar.l, bar.c].some((p) => Math.abs(p / mid - 1) > share);
    (bad ? dropped : kept).push(bar);
  });
  return { bars: kept, dropped };
}

/** Wilder ATR; value at i uses candles 0..i only. */
export function atr(bars: Bar[], period = ATR_PERIOD): (number | null)[] {
  const out: (number | null)[] = bars.map(() => null);
  let value = 0;
  for (let i = 0; i < bars.length; i++) {
    const prev = bars[i - 1];
    const tr = prev
      ? Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - prev.c), Math.abs(bars[i].l - prev.c))
      : bars[i].h - bars[i].l;
    if (i < period) {
      value += tr / period;
      if (i === period - 1) out[i] = value;
    } else {
      value = (value * (period - 1) + tr) / period;
      out[i] = value;
    }
  }
  return out;
}

/** Context computed once per series. Every value at index i uses candles 0..i only. */
export type Context = {
  bars: Bar[];
  fast: (number | null)[];
  slow: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
  atr: (number | null)[];
  patterns: Map<number, Set<string>>;
};

export function context(bars: Bar[]): Context {
  const chart = calculateChart(bars, FAST, SLOW);
  const byTime = (points: { time: number | string; value: number }[]) => {
    const map = new Map(points.map((p) => [Number(p.time), p.value]));
    return bars.map((b) => map.get(b.t) ?? null);
  };
  const patterns = new Map<number, Set<string>>();
  for (const p of chart.overlays.patterns) {
    const t = Number(p.time);
    if (!patterns.has(t)) patterns.set(t, new Set());
    patterns.get(t)!.add(p.name);
  }
  const closes = bars.map((b) => b.c);
  return {
    bars,
    fast: ema(closes, FAST),
    slow: ema(closes, SLOW),
    upper: byTime(chart.overlays.bollinger.upper),
    lower: byTime(chart.overlays.bollinger.lower),
    atr: atr(bars),
    patterns,
  };
}

/** Side to trade at the close of candle i, or 0. Uses candles 0..i only. */
export function signalAt(ctx: Context, i: number, s: Strategy): Side | 0 {
  const { bars } = ctx;
  const bar = bars[i];
  if (flat(bar) || flat(bars[i - 1])) return 0;
  let side: Side | 0 = 0;
  if (s.signal === "EMA cross") {
    const [f0, s0, f1, s1] = [ctx.fast[i - 1], ctx.slow[i - 1], ctx.fast[i], ctx.slow[i]];
    if (f0 == null || s0 == null || f1 == null || s1 == null) return 0;
    if (f0 <= s0 && f1 > s1) side = 1;
    else if (f0 >= s0 && f1 < s1) side = -1;
  } else if (ctx.patterns.get(bar.t)?.has(s.signal)) {
    side = PATTERN_SIDE[s.signal];
  }
  if (!side) return 0;
  if (s.mode === "fade") side = side === 1 ? -1 : 1;
  if (s.filter === "trend") {
    const [f, sl] = [ctx.fast[i], ctx.slow[i]];
    if (f == null || sl == null) return 0;
    const up = bar.c > f && f > sl;
    const down = bar.c < f && f < sl;
    if ((side === 1 && !up) || (side === -1 && !down)) return 0;
  }
  if (s.filter === "extreme") {
    const [u, l] = [ctx.upper[i], ctx.lower[i]];
    if (u == null || l == null) return 0;
    if ((side === 1 && bar.l > l) || (side === -1 && bar.h < u)) return 0;
  }
  if (s.exit.kind === "atr" && ctx.atr[i] == null) return 0;
  return side;
}

/** Simulate one trade signalled at the close of candle i. Returns null if it cannot start. */
export function tradeFrom(ctx: Context, i: number, side: Side, exit: Exit, costs: Costs): (Trade & { exitIndex: number }) | null {
  const { bars } = ctx;
  const first = bars[i + 1];
  if (!first || !contiguous(bars[i], first) || flat(first)) return null;
  const entry = first.o;
  const maxBars = exit.kind === "hold" ? exit.bars : exit.maxBars;
  const range = exit.kind === "atr" ? ctx.atr[i]! : 0;
  const stop = exit.kind === "atr" ? entry - side * exit.stop * range : null;
  const target = exit.kind === "atr" ? entry + side * exit.target * range : null;
  let j = i + 1;
  let price = first.c;
  let reason: ExitReason = "time";
  for (let k = 0; k < maxBars; k++, j++) {
    const bar = bars[j];
    if (!bar) { j--; reason = "end"; price = bars[j].c; break; }
    if (k > 0 && !contiguous(bars[j - 1], bar)) { j--; reason = "gap"; price = bars[j].c; break; }
    if (stop !== null && target !== null) {
      const hitStop = side === 1 ? bar.l <= stop : bar.h >= stop;
      const hitTarget = side === 1 ? bar.h >= target : bar.l <= target;
      // A candle that opens beyond the level fills at the open, not at the level.
      if (hitStop) { reason = "stop"; price = side === 1 ? Math.min(stop, bar.o) : Math.max(stop, bar.o); break; }
      if (hitTarget) { reason = "target"; price = side === 1 ? Math.max(target, bar.o) : Math.min(target, bar.o); break; }
    }
    price = bar.c;
    if (k === maxBars - 1) { reason = "time"; break; }
  }
  const exitBar = bars[Math.min(j, bars.length - 1)];
  const grossBps = side * (price / entry - 1) * 1e4;
  const netBps = grossBps - 2 * (costs.feeBps + costs.slippageBps);
  return {
    signalTime: bars[i].t,
    entryTime: first.t,
    exitTime: exitBar.closeTime,
    side,
    entry,
    exit: price,
    grossBps,
    netBps,
    reason,
    exitIndex: Math.min(j, bars.length - 1),
  };
}

/** Walk forward through the series; one position at a time. */
export function backtest(ctx: Context, s: Strategy, costs: Costs = DEFAULT_COSTS, from = 0, to = ctx.bars.length): Trade[] {
  const trades: Trade[] = [];
  const window = to < ctx.bars.length ? { ...ctx, bars: ctx.bars.slice(0, to) } : ctx;
  let free = from;
  // A signal on the last candle before `to` could only enter outside the window.
  for (let i = Math.max(from, 1); i < to - 1; i++) {
    if (i < free) continue;
    const side = signalAt(ctx, i, s);
    if (!side) continue;
    const trade = tradeFrom(window, i, side, s.exit, costs);
    if (!trade) continue;
    const { exitIndex, ...rest } = trade;
    trades.push(rest);
    free = exitIndex + 1;
  }
  return trades;
}

export function stats(trades: Trade[]): Stats {
  const r = trades.map((t) => t.netBps);
  const n = r.length;
  if (!n) return { trades: 0, winRate: 0, meanBps: 0, medianBps: 0, stdBps: 0, tStat: 0, profitFactor: 0, totalBps: 0, maxDrawdownBps: 0 };
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const std = n > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const sorted = [...r].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const wins = r.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const losses = -r.filter((x) => x < 0).reduce((a, b) => a + b, 0);
  let peak = 0, equity = 0, dd = 0;
  for (const x of r) { equity += x; peak = Math.max(peak, equity); dd = Math.max(dd, peak - equity); }
  return {
    trades: n,
    winRate: r.filter((x) => x > 0).length / n,
    meanBps: mean,
    medianBps: median,
    stdBps: std,
    tStat: std > 0 ? mean / (std / Math.sqrt(n)) : 0,
    profitFactor: losses > 0 ? wins / losses : wins > 0 ? Infinity : 0,
    totalBps: equity,
    maxDrawdownBps: dd,
  };
}

/** Small seeded PRNG so baselines are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random-entry null: the same number of trades, the same long/short mix and the same exit
 * rule, but entered on randomly chosen tradable candles. Returns the null distribution of
 * mean net return and a one-sided p-value for the observed mean.
 */
export function randomBaseline(
  series: { ctx: Context; from: number; to: number; trades: Trade[] }[],
  s: Strategy,
  costs: Costs = DEFAULT_COSTS,
  runs = 1000,
  seed = 7,
) {
  const random = rng(seed);
  const all = series.flatMap((x) => x.trades);
  const observed = all.length ? all.reduce((a, t) => a + t.netBps, 0) / all.length : 0;
  const means: number[] = [];
  const eligible = series.map(({ ctx, from, to }) => {
    const idx: number[] = [];
    for (let i = Math.max(from, 1); i < to - 1; i++) {
      if (flat(ctx.bars[i]) || flat(ctx.bars[i - 1])) continue;
      if (s.exit.kind === "atr" && ctx.atr[i] == null) continue;
      idx.push(i);
    }
    return idx;
  });
  for (let r = 0; r < runs; r++) {
    let sum = 0, count = 0;
    series.forEach(({ ctx, to, trades }, k) => {
      const pool = eligible[k];
      if (!pool.length) return;
      const bars = ctx.bars.slice(0, to);
      for (const t of trades) {
        const i = pool[Math.floor(random() * pool.length)];
        const trade = tradeFrom({ ...ctx, bars }, i, t.side, s.exit, costs);
        if (trade) { sum += trade.netBps; count++; }
      }
    });
    means.push(count ? sum / count : 0);
  }
  const atLeast = means.filter((m) => m >= observed).length;
  means.sort((a, b) => a - b);
  return {
    observedMeanBps: observed,
    nullMedianBps: means[Math.floor(runs / 2)],
    null95Bps: means[Math.floor(runs * 0.95)],
    pValue: (atLeast + 1) / (runs + 1),
  };
}

export const describe = (s: Strategy) =>
  `${s.signal} · ${s.mode} · filter ${s.filter} · ${
    s.exit.kind === "hold" ? `hold ${s.exit.bars}` : `ATR stop ${s.exit.stop} / target ${s.exit.target} (max ${s.exit.maxBars})`
  }`;
