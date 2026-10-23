import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atr, backtest, context, dropBadPrints, randomBaseline, signalAt, stats, tradeFrom } from '../app/backtest.ts';

const H = 3600000;
// SYNTHETIC hourly candles: [open, high, low, close].
const make = (rows, start = 0) => rows.map(([o, h, l, c], i) => ({
  t: start + i * H, closeTime: start + (i + 1) * H, o, h, l, c, v: 1, closed: true,
}));
const noCost = { feeBps: 0, slippageBps: 0 };
// Down candle, then an up candle whose body contains it: a bullish engulfing at index 1.
const engulf = [[101, 101.5, 99.5, 100], [99.8, 102.5, 99.5, 102], [102, 103, 101.5, 102.5], [102.5, 104, 102, 103.5], [103.5, 104, 103, 103.8]];
const follow1 = { signal: 'Bullish engulfing', mode: 'follow', filter: 'none', exit: { kind: 'hold', bars: 1 } };

test('a signal is known at its close and entered at the next open', () => {
  const trades = backtest(context(make(engulf)), follow1, noCost);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].signalTime, H);
  assert.equal(trades[0].entryTime, 2 * H);
  assert.equal(trades[0].entry, 102);
  assert.equal(trades[0].exit, 102.5);
  assert.ok(Math.abs(trades[0].grossBps - (102.5 / 102 - 1) * 1e4) < 1e-9);
});

test('signals never change when future candles are appended', () => {
  const bars = make(engulf);
  const more = make([...engulf, [103.8, 110, 90, 95], [95, 96, 80, 81]]);
  const a = context(bars), b = context(more);
  for (let i = 1; i < bars.length; i++) assert.equal(signalAt(a, i, follow1), signalAt(b, i, follow1));
  const shortAtr = atr(bars), longAtr = atr(more);
  shortAtr.forEach((v, i) => assert.equal(v, longAtr[i]));
});

test('costs are charged on both sides of every trade', () => {
  const [gross] = backtest(context(make(engulf)), follow1, noCost);
  const [net] = backtest(context(make(engulf)), follow1, { feeBps: 5, slippageBps: 3 });
  assert.ok(Math.abs(gross.grossBps - net.netBps - 16) < 1e-9);
});

test('when one candle touches both stop and target, the stop fills first', () => {
  const rows = [...engulf.slice(0, 2), [102, 120, 80, 102], [102, 103, 101, 102]];
  const ctx = context(make(rows));
  ctx.atr[1] = 1; // SYNTHETIC: fixed range so the levels are 101 and 104.
  const trade = tradeFrom(ctx, 1, 1, { kind: 'atr', stop: 1, target: 2, maxBars: 5 }, noCost);
  assert.equal(trade.reason, 'stop');
  assert.equal(trade.exit, 101);
});

test('a candle that opens beyond the stop fills at its open, not at the stop', () => {
  // Entry at 102 (stop 101); the following candle gaps down and opens at 99.
  const rows = [...engulf.slice(0, 2), [102, 103, 101.5, 102.5], [99, 100, 98, 99]];
  const ctx = context(make(rows));
  ctx.atr[1] = 1;
  const trade = tradeFrom(ctx, 1, 1, { kind: 'atr', stop: 1, target: 2, maxBars: 5 }, noCost);
  assert.equal(trade.exit, 99);
});

test('no trade starts across a gap or on candles without trading', () => {
  const gapped = make(engulf);
  for (let i = 2; i < gapped.length; i++) { gapped[i].t += H; gapped[i].closeTime += H; }
  assert.equal(backtest(context(gapped), follow1, noCost).length, 0);
  const flatSignal = engulf.map((r) => [...r]);
  flatSignal[0] = [101, 101, 101, 101];
  assert.equal(backtest(context(make(flatSignal)), follow1, noCost).length, 0);
});

test('a gap during a trade closes it at the last real close', () => {
  const bars = make(engulf);
  bars[4].t += H; bars[4].closeTime += H;
  const trade = tradeFrom(context(bars), 1, 1, { kind: 'hold', bars: 4 }, noCost);
  assert.equal(trade.reason, 'gap');
  assert.equal(trade.exit, 103.5);
});

test('statistics and the random baseline are reproducible', () => {
  const t = (netBps) => ({ netBps });
  const s = stats([t(10), t(-5), t(20), t(-5)]);
  assert.equal(s.trades, 4);
  assert.equal(s.winRate, 0.5);
  assert.equal(s.meanBps, 5);
  assert.equal(s.profitFactor, 3);
  assert.equal(s.maxDrawdownBps, 5);
  const ctx = context(make(Array.from({ length: 80 }, (_, i) => [100 + Math.sin(i), 101 + Math.sin(i), 99 + Math.sin(i), 100 + Math.cos(i)])));
  const trades = backtest(ctx, { ...follow1, signal: 'EMA cross' }, noCost);
  const a = randomBaseline([{ ctx, from: 0, to: 80, trades }], follow1, noCost, 50, 3);
  const b = randomBaseline([{ ctx, from: 0, to: 80, trades }], follow1, noCost, 50, 3);
  assert.deepEqual(a, b);
  assert.ok(a.pValue > 0 && a.pValue <= 1);
});

test('isolated bad prints are dropped, real trends are kept', () => {
  const steady = Array.from({ length: 12 }, (_, i) => [100 + i, 101 + i, 99 + i, 100.5 + i]);
  const spiked = steady.map((r) => [...r]);
  spiked[0] = [4800, 4800, 4800, 4800];       // another market's price at the start
  spiked[6] = [106, 106.5, 40, 106.2];        // a wick to a round number
  const { bars, dropped } = dropBadPrints(make(spiked));
  assert.deepEqual(dropped.map((b) => b.t / H), [0, 6]);
  assert.equal(bars.length, 10);
  assert.equal(dropBadPrints(make(steady)).dropped.length, 0);
  // A sustained 2x move over many candles is not a bad print.
  const rally = Array.from({ length: 30 }, (_, i) => { const p = 100 * 1.03 ** i; return [p, p * 1.01, p * 0.99, p * 1.03]; });
  assert.equal(dropBadPrints(make(rally)).dropped.length, 0);
});
