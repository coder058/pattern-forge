import test from 'node:test';
import assert from 'node:assert/strict';
import { toFrames, STORED_BARS, STORED_INTERVALS } from '../app/storedMarket.ts';
import { INTERVAL_MS } from '../app/marketAnalysis.ts';

// SOURCE: SYNTHETIC stored rows shaped like a node-postgres result, not observations.
const HOUR = INTERVAL_MS['1h'];
const row = (openTime, overrides = {}) => ({
  interval: '1h',
  open_time: openTime,
  close_time: openTime + HOUR,
  open: 100, high: 104.5, low: 96.5, close: 101, volume: 12,
  ...overrides,
});

test('SYNTHETIC: groups rows per interval, sorts them and reports counts', () => {
  const { frames, counts, asOf } = toFrames([
    row(HOUR * 3),
    row(HOUR),
    { ...row(0), interval: '4h', close_time: INTERVAL_MS['4h'] },
  ]);
  assert.deepEqual(frames['1h'].map(bar => bar.t), [HOUR, HOUR * 3]);
  assert.equal(frames['4h'].length, 1);
  assert.deepEqual(counts, { '1h': 2, '4h': 1 });
  // The cutoff is the newest stored close, so every stored bar stays visible.
  assert.equal(asOf, HOUR * 4);
});

test('SYNTHETIC: bigint columns arriving as strings are accepted within safe range', () => {
  const openTime = 1_788_220_800_000;
  const { frames } = toFrames([row(openTime, {
    open_time: String(openTime), close_time: String(openTime + HOUR), open: '100.25', volume: '3',
  })]);
  assert.equal(frames['1h'][0].t, openTime);
  assert.equal(frames['1h'][0].o, 100.25);
  assert.equal(frames['1h'][0].v, 3);
});

test('SYNTHETIC: an interval the reader does not serve is skipped, not charted', () => {
  const { frames, asOf } = toFrames([{ ...row(0), interval: '5m', close_time: INTERVAL_MS['5m'] }]);
  assert.deepEqual(frames, {});
  assert.equal(asOf, 0);
  assert.ok(!STORED_INTERVALS.includes('5m'));
});

test('SYNTHETIC: one row per opening time survives', () => {
  const { frames, counts } = toFrames([row(HOUR), row(HOUR, { close: 103 })]);
  assert.equal(counts['1h'], 1);
  assert.equal(frames['1h'][0].c, 103);
});

test('SYNTHETIC: storage faults are reported instead of being drawn', () => {
  const cases = {
    'does not span its interval': row(HOUR, { close_time: HOUR + HOUR / 2 }),
    'unusable timestamp': row(HOUR, { open_time: 1.5 }),
    'unsafe timestamp': row(HOUR, { open_time: '9007199254740993' }),
    'unusable price': row(HOUR, { close: 'not-a-number' }),
    'missing volume': row(HOUR, { volume: null }),
    'high below body': row(HOUR, { high: 99 }),
    'low above body': row(HOUR, { low: 100.5 }),
    'non-positive low': row(HOUR, { low: 0, open: 0.5, close: 0.5, high: 1 }),
    'negative volume': row(HOUR, { volume: -1 }),
  };
  for (const [name, candidate] of Object.entries(cases)) {
    assert.throws(() => toFrames([candidate]), undefined, name);
  }
});

test('SYNTHETIC: the read bound is a fixed number of bars per interval', () => {
  assert.equal(STORED_BARS, 300);
});
