"use client";

import { useMemo, useState } from "react";
import type { Bar } from "./marketAnalysis";
import {
  backtest,
  context,
  dropBadPrints,
  randomBaseline,
  stats,
  TRADED_PATTERNS,
  type Exit,
  type Filter,
  type Mode,
  type Signal,
  type Strategy,
} from "./backtest";

// SOURCE: the exits and costs studied in research/backtest/PREREGISTRATION.md.
const EXITS: { label: string; exit: Exit }[] = [
  { label: "1 candle", exit: { kind: "hold", bars: 1 } },
  { label: "4 candles", exit: { kind: "hold", bars: 4 } },
  { label: "12 candles", exit: { kind: "hold", bars: 12 } },
  { label: "ATR stop 1 · target 2", exit: { kind: "atr", stop: 1, target: 2, maxBars: 24 } },
];
const COSTS = [
  { label: "No costs", bps: 0 },
  { label: "16 bps", bps: 16 },
  { label: "32 bps", bps: 32 },
];
// GUESS: UNCALIBRATED GUESS — enough random draws for a stable browser estimate.
const RUNS = 300;
const REPORT = "https://github.com/coder058/pattern-forge/blob/main/research/backtest/REPORT.md";

const REASON: Record<string, string> = {
  time: "time exit", stop: "stopped out", target: "target hit", gap: "closed at a data gap", end: "end of data",
};
const bps = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)} bps`;
const when = (t: number) =>
  new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export function BacktestPanel({ bars, timeframe, initialSignal, onPick }: {
  bars: Bar[];
  timeframe: string;
  initialSignal?: string;
  onPick: (time: number) => void;
}) {
  const [signal, setSignal] = useState<Signal>(
    (TRADED_PATTERNS as readonly string[]).includes(initialSignal ?? "") ? (initialSignal as Signal) : "Bullish engulfing",
  );
  const [mode, setMode] = useState<Mode>("follow");
  const [filter, setFilter] = useState<Filter>("none");
  const [exitIndex, setExitIndex] = useState(1);
  const [costIndex, setCostIndex] = useState(1);
  const result = useMemo(() => {
    const strategy: Strategy = { signal, mode, filter, exit: EXITS[exitIndex].exit };
    // Round trip split evenly between fee and slippage on entry and exit.
    const costs = { feeBps: COSTS[costIndex].bps / 4, slippageBps: COSTS[costIndex].bps / 4 };
    const clean = dropBadPrints(bars).bars;
    const ctx = context(clean);
    const trades = backtest(ctx, strategy, costs);
    const baseline = trades.length
      ? randomBaseline([{ ctx, from: 0, to: clean.length, trades }], strategy, costs, RUNS, 7)
      : null;
    return { trades, s: stats(trades), baseline };
  }, [bars, signal, mode, filter, exitIndex, costIndex]);

  const { trades, s, baseline } = result;
  const curve = useMemo(() => {
    let sum = 0;
    return [0, ...trades.map((t) => (sum += t.netBps))];
  }, [trades]);
  const min = Math.min(0, ...curve), max = Math.max(0, ...curve);
  const y = (v: number) => (max === min ? 30 : 56 - ((v - min) / (max - min)) * 52);
  const path = curve.map((v, i) => `${i ? "L" : "M"}${((i / Math.max(1, curve.length - 1)) * 300).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const beatsRandom = baseline && baseline.pValue < 0.05 && s.meanBps > 0;
  const verdict = !trades.length
    ? "No trades: this rule never fired in the visible history."
    : s.meanBps <= 0
      ? `Lost ${Math.abs(s.meanBps).toFixed(1)} bps per trade after costs.`
      : beatsRandom
        ? `Made ${bps(s.meanBps)} per trade and beat random entries here.`
        : `Made ${bps(s.meanBps)} per trade, but random entries in the same direction did about as well.`;

  return (
    <div className="pf-bt">
      <p className="pf-muted">Would trading this shape have made money? Signal at the candle&apos;s close, entry at the next open, costs on both sides, only candles visible now.</p>
      <label className="pf-field">Signal
        <select aria-label="Backtest signal" value={signal} onChange={(e) => setSignal(e.target.value as Signal)}>
          {[...TRADED_PATTERNS, "EMA cross"].map((name) => <option key={name}>{name}</option>)}
        </select>
      </label>
      <div className="pf-seg" role="group" aria-label="Trade direction">
        {(["follow", "fade"] as Mode[]).map((m) => (
          <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === "follow" ? "Trade with the shape" : "Trade against it"}</button>
        ))}
      </div>
      <div className="pf-seg" role="group" aria-label="Backtest filter">
        {([["none", "Any context"], ["trend", "With the trend"], ["extreme", "At a band extreme"]] as [Filter, string][]).map(([v, l]) => (
          <button key={v} aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>
      <label className="pf-field">Exit
        <select aria-label="Backtest exit" value={exitIndex} onChange={(e) => setExitIndex(Number(e.target.value))}>
          {EXITS.map((x, i) => <option key={x.label} value={i}>{x.label}</option>)}
        </select>
      </label>
      <div className="pf-seg" role="group" aria-label="Round-trip costs">
        {COSTS.map((c, i) => <button key={c.label} aria-pressed={costIndex === i} onClick={() => setCostIndex(i)}>{c.label}</button>)}
      </div>

      <div className={`pf-verdict ${!trades.length ? "" : s.meanBps > 0 && beatsRandom ? "bull" : "bear"}`} data-testid="backtest-verdict" data-trades={trades.length} data-last-exit={trades.at(-1)?.exitTime ?? ""}>
        <small>{timeframe} · {trades.length} trades · {COSTS[costIndex].label} round trip</small>
        <strong>{verdict}</strong>
        {baseline && (
          <p>Random entries, same direction and exit: median {bps(baseline.nullMedianBps)} per trade · p = {baseline.pValue.toFixed(2)}.</p>
        )}
      </div>
      {trades.length > 0 && (
        <>
          <svg className="pf-equity" viewBox="0 0 300 60" role="img" aria-label={`Cumulative net result ${bps(s.totalBps)}`}>
            <line x1="0" x2="300" y1={y(0)} y2={y(0)} />
            <path d={path} className={s.totalBps >= 0 ? "up" : "down"} />
          </svg>
          <dl className="pf-bt-stats">
            <div><dt>Win rate</dt><dd>{(s.winRate * 100).toFixed(0)}%</dd></div>
            <div><dt>Profit factor</dt><dd>{Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "∞"}</dd></div>
            <div><dt>Total</dt><dd>{bps(s.totalBps)}</dd></div>
            <div><dt>Max drawdown</dt><dd>{s.maxDrawdownBps.toFixed(0)} bps</dd></div>
          </dl>
          <h3 className="pf-list-title">Latest trades</h3>
          <ul className="pf-hits">
            {trades.slice(-8).reverse().map((t) => (
              <li key={t.signalTime}>
                <button className="mw-pattern-hit" onClick={() => onPick(t.signalTime)}>
                  <i className={`pf-dot ${t.side === 1 ? "bull" : "bear"}`} aria-hidden="true" />
                  <span>
                    <strong>{t.side === 1 ? "Long" : "Short"} · <b className={t.netBps >= 0 ? "up" : "down"}>{bps(t.netBps)}</b></strong>
                    <time>{when(t.signalTime)} UTC · {REASON[t.reason]}</time>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="pf-muted">
        Preregistered study on all ten recordings: no shape survived a held-out test after costs. <a href={REPORT} target="_blank" rel="noreferrer">Read the report ↗</a>
      </p>
    </div>
  );
}
