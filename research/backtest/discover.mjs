// Stage 1: search the strategy grid on the DISCOVERY window only (earlier 60% of each market).
// Writes research/backtest/discovery.json and candidates.json. Never reads the holdout window.
import { writeFileSync } from 'node:fs';
import { backtest, stats, DEFAULT_COSTS } from '../../app/backtest.ts';
import { loadRecordings, grid, key, MIN_TRADES } from './common.mjs';

const markets = loadRecordings();
const rows = [];
for (const config of grid()) {
  const perMarket = markets.map((m) => {
    const { ctx, split } = m.frames[config.timeframe];
    return { id: m.id, trades: backtest(ctx, config.strategy, DEFAULT_COSTS, 0, split) };
  });
  const all = perMarket.flatMap((x) => x.trades);
  const s = stats(all);
  const marketsPositive = perMarket.filter((x) => x.trades.length && stats(x.trades).meanBps > 0).length;
  const marketsTraded = perMarket.filter((x) => x.trades.length).length;
  rows.push({ key: key(config), config, ...s, marketsPositive, marketsTraded,
    grossMeanBps: all.length ? all.reduce((a, t) => a + t.grossBps, 0) / all.length : 0 });
}

const ranked = rows.filter((r) => r.trades >= MIN_TRADES).sort((a, b) => b.tStat - a.tStat);
const positive = ranked.filter((r) => r.meanBps > 0);
// SOURCE: preregistered selection rule (research/backtest/PREREGISTRATION.md): the three
// highest discovery t-statistics with positive net mean and at least MIN_TRADES trades.
// If nothing is positive, the top three by t-statistic still go to the holdout as a negative result.
const candidates = (positive.length ? positive : ranked).slice(0, 3).map((r) => ({ key: r.key, config: r.config, discovery: {
  trades: r.trades, meanBps: r.meanBps, tStat: r.tStat, profitFactor: r.profitFactor, marketsPositive: r.marketsPositive, marketsTraded: r.marketsTraded } }));

writeFileSync(new URL('./discovery.json', import.meta.url), JSON.stringify({
  costs: DEFAULT_COSTS,
  configsTested: rows.length,
  configsWithEnoughTrades: ranked.length,
  configsPositiveAfterCosts: positive.length,
  markets: markets.map((m) => ({ id: m.id, sha256: m.sha256, badPrintsDropped: m.dropped, splitTime: new Date(m.split).toISOString() })),
  rows: rows.sort((a, b) => b.tStat - a.tStat),
}, null, 1));
writeFileSync(new URL('./candidates.json', import.meta.url), JSON.stringify(candidates, null, 2) + '\n');

const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
console.log(`configs ${rows.length} · with ≥${MIN_TRADES} trades ${ranked.length} · positive after costs ${positive.length}`);
console.log('rank | config | trades | net mean bps | gross mean bps | t | PF | win% | markets +/traded');
ranked.slice(0, 15).forEach((r, i) => console.log(
  `${i + 1} | ${r.key} | ${r.trades} | ${f(r.meanBps)} | ${f(r.grossMeanBps)} | ${f(r.tStat, 2)} | ${f(r.profitFactor, 2)} | ${f(r.winRate * 100, 0)} | ${r.marketsPositive}/${r.marketsTraded}`));
