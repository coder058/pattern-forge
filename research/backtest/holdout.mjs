// Stage 2: evaluate the frozen candidates ONCE on the holdout window (later 40% of each
// market), then on the external EUR/USD and GOOG fixtures. Pass criteria are fixed in
// PREREGISTRATION.md; this script only applies them. Writes holdout.json.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { aggregateBars } from '../../app/marketAnalysis.ts';
import { backtest, context, randomBaseline, stats, DEFAULT_COSTS } from '../../app/backtest.ts';
import { loadRecordings } from './common.mjs';

const candidates = JSON.parse(readFileSync(new URL('./candidates.json', import.meta.url)));
const markets = loadRecordings();
// SOURCE: PREREGISTRATION.md pass criteria.
const ALPHA = 0.05 / candidates.length;
const MIN_HOLDOUT_TRADES = 20;
const RUNS = 1000;
const SEED = 7;

// SOURCE: backtesting.py test fixtures at a pinned commit; hashes recorded on first download.
const COMMIT = 'ca2e2611621e472542ba90f7243a1fa06a7d7108';
const EXTERNAL = {
  EURUSD: { sha256: '81e977905a006cc8fbc034ebdb83c999a8ed6ba00191dc7ea5ef5b386fb74a82', costs: { feeBps: 0.5, slippageBps: 0.5 }, hours: 1 },
  GOOG: { sha256: '60e961a567490b157f71888df9e6afb36190a34a40a6286aa38988e2343f1b1a', costs: { feeBps: 3, slippageBps: 2 }, hours: 24 },
};

function external(name) {
  const dir = new URL('./.cache/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const file = new URL(`${name}.csv`, dir);
  if (!existsSync(file))
    execFileSync('curl', ['-sS', '-m', '60', '-o', file.pathname,
      `https://raw.githubusercontent.com/kernc/backtesting.py/${COMMIT}/backtesting/test/${name}.csv`]);
  const raw = readFileSync(file);
  const hash = createHash('sha256').update(raw).digest('hex');
  if (hash !== EXTERNAL[name].sha256) throw new Error(`${name}.csv hash mismatch: ${hash}`);
  const span = EXTERNAL[name].hours * 3600000;
  const rows = raw.toString().trim().split('\n').slice(1).map((line) => line.split(','));
  // Daily sessions are treated as consecutive candles (weekends are not gaps for a daily
  // equity series); hourly FX keeps real timestamps, so weekend gaps stay gaps.
  return rows.map(([time, o, h, l, c, v], i) => {
    const t = EXTERNAL[name].hours === 24 ? i * span : Date.parse(time.replace(' ', 'T') + 'Z');
    return { t, closeTime: t + span, o: +o, h: +h, l: +l, c: +c, v: +v, closed: true };
  });
}

const report = { alpha: ALPHA, runs: RUNS, seed: SEED, candidates: [] };
for (const cand of candidates) {
  const { timeframe, strategy } = cand.config;
  const series = markets.map((m) => {
    const { ctx, split } = m.frames[timeframe];
    return { id: m.id, ctx, from: split, to: ctx.bars.length, trades: backtest(ctx, strategy, DEFAULT_COSTS, split, ctx.bars.length) };
  });
  const all = series.flatMap((s) => s.trades);
  const s = stats(all);
  const traded = series.filter((x) => x.trades.length);
  const positiveMarkets = traded.filter((x) => stats(x.trades).meanBps > 0).length;
  const baseline = randomBaseline(series, strategy, DEFAULT_COSTS, RUNS, SEED);
  const checks = {
    meanPositive: s.meanBps > 0,
    beatsRandom: baseline.pValue < ALPHA,
    halfOfMarkets: positiveMarkets >= traded.length / 2,
    enoughTrades: s.trades >= MIN_HOLDOUT_TRADES,
  };
  const ext = {};
  for (const name of Object.keys(EXTERNAL)) {
    let bars = external(name);
    if (name === 'EURUSD' && timeframe === '4h') bars = aggregateBars(bars, '1h', '4h', bars.at(-1).closeTime);
    const ctx = context(bars);
    const trades = backtest(ctx, strategy, EXTERNAL[name].costs);
    const b = randomBaseline([{ ctx, from: 0, to: bars.length, trades }], strategy, EXTERNAL[name].costs, RUNS, SEED);
    ext[name] = { ...stats(trades), pValue: b.pValue, nullMedianBps: b.nullMedianBps };
  }
  report.candidates.push({
    key: cand.key,
    discovery: cand.discovery,
    holdout: { ...s, positiveMarkets, tradedMarkets: traded.length, ...baseline,
      perMarket: series.map((x) => ({ id: x.id, ...stats(x.trades) })) },
    checks,
    passed: Object.values(checks).every(Boolean),
    external: ext,
  });
}
writeFileSync(new URL('./holdout.json', import.meta.url), JSON.stringify(report, null, 1));

const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
for (const c of report.candidates) {
  const h = c.holdout;
  console.log(`\n${c.passed ? 'PASS' : 'FAIL'} · ${c.key}`);
  console.log(`  discovery: ${c.discovery.trades} trades, ${f(c.discovery.meanBps)} bps, t ${f(c.discovery.tStat, 2)}`);
  console.log(`  holdout:   ${h.trades} trades, ${f(h.meanBps)} bps net, t ${f(h.tStat, 2)}, PF ${f(h.profitFactor, 2)}, win ${f(h.winRate * 100, 0)}%, markets +${h.positiveMarkets}/${h.tradedMarkets}`);
  console.log(`  random-entry null: median ${f(h.nullMedianBps)} bps, 95th pct ${f(h.null95Bps)} bps, p = ${h.pValue.toFixed(3)} (need < ${ALPHA.toFixed(4)})`);
  console.log(`  checks: ${Object.entries(c.checks).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join(' · ')}`);
  for (const [name, e] of Object.entries(c.external))
    console.log(`  external ${name}: ${e.trades} trades, ${f(e.meanBps)} bps net, t ${f(e.tStat, 2)}, p ${e.pValue.toFixed(3)}`);
}
