// Shared data loading and strategy grid for the pattern backtest study.
import { readFileSync } from 'node:fs';
import { aggregateBars } from '../../app/marketAnalysis.ts';
import { context, TRADED_PATTERNS } from '../../app/backtest.ts';

const root = new URL('../../', import.meta.url);
// SOURCE: the study's frozen split: earlier 60% of each market for discovery, later 40% held out.
export const DISCOVERY_SHARE = 0.6;
// SOURCE: minimum pooled trades before a discovery result is ranked at all.
export const MIN_TRADES = 40;

export function loadRecordings() {
  const catalog = JSON.parse(readFileSync(new URL('public/recordings/catalog.json', root)));
  return catalog.map((item) => {
    const doc = JSON.parse(readFileSync(new URL(`public${item.path}`, root)));
    const hourly = doc.candles;
    // One time boundary per market, applied to every timeframe.
    const split = hourly[Math.floor(hourly.length * DISCOVERY_SHARE)].t;
    const frames = {
      '1h': hourly,
      '4h': aggregateBars(hourly, '1h', '4h', doc.metadata.asOf),
    };
    return {
      id: item.id,
      label: item.label,
      sha256: item.sourceSha256,
      split,
      frames: Object.fromEntries(Object.entries(frames).map(([tf, bars]) => {
        const at = bars.findIndex((b) => b.closeTime > split);
        return [tf, { ctx: context(bars), split: at < 0 ? bars.length : at }];
      })),
    };
  });
}

export function grid() {
  const exits = [
    { kind: 'hold', bars: 1 },
    { kind: 'hold', bars: 4 },
    { kind: 'hold', bars: 12 },
    { kind: 'atr', stop: 1, target: 1.5, maxBars: 24 },
    { kind: 'atr', stop: 1, target: 2, maxBars: 24 },
    { kind: 'atr', stop: 1.5, target: 3, maxBars: 48 },
  ];
  const out = [];
  for (const timeframe of ['1h', '4h'])
    for (const signal of [...TRADED_PATTERNS, 'EMA cross'])
      for (const mode of ['follow', 'fade'])
        for (const filter of ['none', 'trend', 'extreme'])
          for (const exit of exits) out.push({ timeframe, strategy: { signal, mode, filter, exit } });
  return out;
}

export const key = ({ timeframe, strategy: s }) =>
  `${timeframe} | ${s.signal} | ${s.mode} | ${s.filter} | ${s.exit.kind === 'hold' ? `hold ${s.exit.bars}` : `atr ${s.exit.stop}/${s.exit.target}/${s.exit.maxBars}`}`;
