import type {
  ProfessionalChartCandle,
  ProfessionalChartData,
  ProfessionalChartPoint,
} from "./ProfessionalChart";

export type Bar = ProfessionalChartCandle & { t: number; closeTime: number };
export type Interval = "5m" | "30m" | "1h" | "4h" | "1d";
// SOURCE: exact UTC durations, not trading parameters.
export const INTERVAL_MS: Record<Interval, number> = {
  "5m": 300000,
  "30m": 1800000,
  "1h": 3600000,
  "4h": 14400000,
  "1d": 86400000,
};
// SOURCE: conventional display defaults (EMA, Bollinger, Wilder RSI and MACD).
// https://www.tradingview.com/support/solutions/43000502589-moving-averages/
// These are descriptive indicators, not calibrated strategy settings.
export const DEFAULT_INDICATORS = {
  fast: 20,
  slow: 50,
  bandPeriod: 20,
  deviations: 2,
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
};
// GUESS: UNCALIBRATED GUESS — geometric pattern definitions for exploration only.
export const PATTERN_RULES = { dojiRatio: 0.1, wickRatio: 2, pivotWing: 3 };

export function validateBars(
  value: unknown,
  interval: Interval,
  asOf: number,
): Bar[] {
  if (!Number.isSafeInteger(asOf) || asOf < 0)
    throw new Error("Invalid recording cutoff.");
  if (!Array.isArray(value))
    throw new Error("The recording does not contain candles.");
  const rows = new Map<number, Bar>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") throw new Error("Invalid candle row.");
    const t = typeof raw.t === "number" ? raw.t : Date.parse(raw.t);
    const closeTime =
      raw.closeTime ??
      (raw.T === undefined ? t + INTERVAL_MS[interval] : Number(raw.T) + 1);
    if (
      !Number.isSafeInteger(t) ||
      t < 0 ||
      !Number.isSafeInteger(closeTime) ||
      closeTime !== t + INTERVAL_MS[interval]
    )
      throw new Error("Invalid candle duration.");
    if (closeTime > asOf) continue;
    if (
      ![raw.o, raw.h, raw.l, raw.c].every(
        (v) => typeof v === "number" && Number.isFinite(v),
      ) ||
      raw.l <= 0 ||
      raw.h < Math.max(raw.o, raw.c, raw.l) ||
      raw.l > Math.min(raw.o, raw.c)
    )
      throw new Error("Invalid OHLC values.");
    if (
      raw.v !== undefined &&
      (typeof raw.v !== "number" || !Number.isFinite(raw.v) || raw.v < 0)
    )
      throw new Error("Invalid volume.");
    const row: Bar = {
      t,
      closeTime,
      o: raw.o,
      h: raw.h,
      l: raw.l,
      c: raw.c,
      ...(raw.v !== undefined ? { v: raw.v } : {}),
      closed: true,
    };
    if (rows.has(t) && JSON.stringify(rows.get(t)) !== JSON.stringify(row))
      throw new Error("Conflicting duplicate candle.");
    rows.set(t, row);
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

/** Only complete UTC-aligned groups; never fill gaps or expose future bars. */
export function aggregateBars(
  bars: Bar[],
  base: Interval,
  target: Interval,
  cutoff: number,
): Bar[] {
  const span = INTERVAL_MS[target],
    baseSpan = INTERVAL_MS[base];
  if (span < baseSpan || span % baseSpan) return [];
  const groups = new Map<number, Bar[]>();
  for (const bar of bars) {
    if (bar.closeTime > cutoff) continue;
    const key = Math.floor(bar.t / span) * span;
    groups.set(key, [...(groups.get(key) ?? []), bar]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([t, group]) => {
      group.sort((a, b) => a.t - b.t);
      if (
        t + span > cutoff ||
        group.length !== span / baseSpan ||
        group.some((b, i) => b.t !== t + i * baseSpan)
      )
        return [];
      return [
        {
          t,
          closeTime: t + span,
          o: group[0].o,
          h: Math.max(...group.map((b) => b.h)),
          l: Math.min(...group.map((b) => b.l)),
          c: group.at(-1)!.c,
          ...(group.every((b) => b.v !== undefined)
            ? { v: group.reduce((sum, b) => sum + b.v!, 0) }
            : {}),
          closed: true,
        },
      ];
    });
}

export function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = values.map(() => null);
  if (values.length < period) return result;
  let average = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = average;
  // SOURCE: standard EMA smoothing recurrence; SMA seeded after a full window.
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    average = values[i] * alpha + average * (1 - alpha);
    result[i] = average;
  }
  return result;
}

export function rsi(
  bars: Bar[],
  period = DEFAULT_INDICATORS.rsiPeriod,
): ProfessionalChartPoint[] {
  if (bars.length <= period) return [];
  let gain = 0,
    loss = 0;
  const result: ProfessionalChartPoint[] = [];
  for (let i = 1; i < bars.length; i++) {
    const change = bars[i].c - bars[i - 1].c;
    if (i <= period) {
      gain += Math.max(0, change) / period;
      loss += Math.max(0, -change) / period;
    } else {
      gain = (gain * (period - 1) + Math.max(0, change)) / period;
      loss = (loss * (period - 1) + Math.max(0, -change)) / period;
    }
    // SOURCE: Wilder RSI formula; flat window explicitly neutral, no division by zero.
    if (i >= period)
      result.push({
        time: bars[i].t,
        value:
          gain === 0 && loss === 0
            ? 50
            : loss === 0
              ? 100
              : 100 - 100 / (1 + gain / loss),
      });
  }
  return result;
}

export function calculateChart(
  bars: Bar[],
  fastPeriod = DEFAULT_INDICATORS.fast,
  slowPeriod = DEFAULT_INDICATORS.slow,
): ProfessionalChartData {
  const closes = bars.map((b) => b.c),
    fast = ema(closes, fastPeriod),
    slow = ema(closes, slowPeriod);
  const points = (values: (number | null)[]) =>
    values.flatMap((value, i) =>
      value === null ? [] : [{ time: bars[i].t, value }],
    );
  const data: ProfessionalChartData = {
    candles: bars,
    overlays: {
      ema: points(fast),
      emaSlow: points(slow),
      bollinger: { upper: [], middle: [], lower: [] },
      trendlines: [],
      patterns: [],
      touches: [],
      plans: [],
    },
  };
  bars.forEach((bar, i) => {
    const period = DEFAULT_INDICATORS.bandPeriod;
    if (i >= period - 1) {
      const window = closes.slice(i - period + 1, i + 1),
        mean = window.reduce((a, b) => a + b, 0) / period,
        sd = Math.sqrt(
          window.reduce((s, x) => s + (x - mean) ** 2, 0) / period,
        );
      data.overlays.bollinger.middle.push({ time: bar.t, value: mean });
      data.overlays.bollinger.upper.push({
        time: bar.t,
        value: mean + DEFAULT_INDICATORS.deviations * sd,
      });
      data.overlays.bollinger.lower.push({
        time: bar.t,
        value: mean - DEFAULT_INDICATORS.deviations * sd,
      });
    }
    const range = bar.h - bar.l,
      body = Math.abs(bar.c - bar.o),
      lower = Math.min(bar.o, bar.c) - bar.l,
      upper = bar.h - Math.max(bar.o, bar.c),
      previous = bars[i - 1];
    const add = (name: string, direction: string, variant: string) =>
      data.overlays.patterns.push({
        name,
        direction,
        variant,
        time: bar.t,
        knownAt: bar.closeTime,
        price: bar.c,
      });
    if (range > 0 && body / range <= PATTERN_RULES.dojiRatio)
      add(
        "Doji",
        "neutral",
        "Small body relative to range; indecision shape, not a signal.",
      );
    if (body > 0 && lower >= body * PATTERN_RULES.wickRatio && upper <= body)
      add(
        "Hammer shape",
        "bullish",
        "Long lower wick; no trend or next-bar confirmation assumed.",
      );
    if (body > 0 && upper >= body * PATTERN_RULES.wickRatio && lower <= body)
      add(
        "Shooting-star shape",
        "bearish",
        "Long upper wick; context is required.",
      );
    // SOURCE: body-engulfing definition; do not bridge missing candles.
    if (previous && previous.closeTime === bar.t) {
      if (
        previous.c < previous.o &&
        bar.c > bar.o &&
        bar.o <= previous.c &&
        bar.c >= previous.o
      )
        add(
          "Bullish engulfing",
          "bullish",
          "Up body contains the preceding down body.",
        );
      if (
        previous.c > previous.o &&
        bar.c < bar.o &&
        bar.o >= previous.c &&
        bar.c <= previous.o
      )
        add(
          "Bearish engulfing",
          "bearish",
          "Down body contains the preceding up body.",
        );
    }
  });
  const wing = PATTERN_RULES.pivotWing;
  for (const kind of ["support", "resistance"] as const) {
    let last: Bar | undefined;
    for (let i = wing; i < bars.length - wing; i++) {
      const window = bars.slice(i - wing, i + wing + 1),
        bar = bars[i];
      if (window.some((b, j) => j > 0 && window[j - 1].closeTime !== b.t))
        continue;
      const isPivot =
        kind === "support"
          ? window.every((b, j) => j === wing || b.l > bar.l)
          : window.every((b, j) => j === wing || b.h < bar.h);
      if (isPivot) {
        if (last)
          data.overlays.trendlines.push({
            kind,
            startTime: last.t,
            startPrice: kind === "support" ? last.l : last.h,
            endTime: bar.t,
            endPrice: kind === "support" ? bar.l : bar.h,
            confirmedAt: bars[i + wing].closeTime,
          });
        last = bar;
      }
    }
  }
  return data;
}

export function macd(bars: Bar[]) {
  const values = bars.map((b) => b.c),
    fast = ema(values, DEFAULT_INDICATORS.macdFast),
    slow = ema(values, DEFAULT_INDICATORS.macdSlow);
  const line = bars.flatMap((b, i) =>
    fast[i] === null || slow[i] === null
      ? []
      : [{ time: b.t, value: fast[i]! - slow[i]! }],
  );
  const smooth = ema(
    line.map((p) => p.value),
    DEFAULT_INDICATORS.macdSignal,
  );
  const signal = line.flatMap((p, i) =>
    smooth[i] === null ? [] : [{ time: p.time, value: smooth[i]! }],
  );
  return {
    line,
    signal,
    histogram: line.flatMap((p, i) =>
      smooth[i] === null ? [] : [{ time: p.time, value: p.value - smooth[i]! }],
    ),
  };
}

export function summarize(bars: Bar[]) {
  const chart = calculateChart(bars),
    last = bars.at(-1),
    fast = chart.overlays.ema.at(-1)?.value,
    slow = chart.overlays.emaSlow.at(-1)?.value;
  return {
    last,
    trend:
      !last || fast === undefined || slow === undefined
        ? "Warming up"
        : last.c > fast && fast > slow
          ? "Rising"
          : last.c < fast && fast < slow
            ? "Falling"
            : "Mixed",
    rsi: rsi(bars).at(-1)?.value,
    count: bars.length,
  };
}
