import test from 'node:test';
import assert from 'node:assert/strict';
import { formingFourHour, aggregateBars, calculateChart, INTERVAL_MS } from '../app/marketAnalysis.ts';

const hour = INTERVAL_MS['1h'];
// SOURCE: deliberately constructed SYNTHETIC OHLC to exercise appear/disappear behavior, not prices.
const pairs = [[110,107],[107,104],[104,102],[102,100],[99,111],[111,108],[108,113],[113,112]];
export const SYNTHETIC_FORMING = pairs.map(([o,c], i) => ({
  t:i*hour, closeTime:(i+1)*hour, o, c, h:Math.max(o,c), l:Math.min(o,c), closed:true,
}));

test('SYNTHETIC forming body appears, disappears, then only closes at the 4h boundary', () => {
  const first = formingFourHour(SYNTHETIC_FORMING, 5*hour);
  assert.equal(first.shape, 'Bullish engulfing');
  assert.equal(first.bar.closed, false);
  assert.equal(first.bar.h, 111); // Future 113 is not visible yet.
  assert.equal(first.parts, 1);
  assert.equal(formingFourHour(SYNTHETIC_FORMING, 6*hour).shape, null);
  assert.equal(formingFourHour(SYNTHETIC_FORMING, 7*hour).shape, 'Bullish engulfing');
  assert.equal(formingFourHour(SYNTHETIC_FORMING, 8*hour), null);
  const closed = aggregateBars(SYNTHETIC_FORMING, '1h', '4h', 8*hour);
  assert.equal(closed.length, 2);
  assert.equal(calculateChart(closed).overlays.patterns.some(p => p.name === 'Bullish engulfing'), true);
});

test('SYNTHETIC forming rejects missing/duplicate/nonclosed hours and non-hour cutoffs', () => {
  assert.equal(formingFourHour(SYNTHETIC_FORMING.filter((_,i) => i !== 4), 6*hour), null);
  assert.equal(formingFourHour([...SYNTHETIC_FORMING,SYNTHETIC_FORMING[4]], 5*hour), null);
  assert.equal(formingFourHour(SYNTHETIC_FORMING.map((b,i) => i === 4 ? {...b,closed:false} : b), 5*hour), null);
  assert.equal(formingFourHour(SYNTHETIC_FORMING, 5*hour+1), null);
});

test('SYNTHETIC future input and preview cannot alter the confirmed prefix; rewind is deterministic', () => {
  const before = calculateChart(aggregateBars(SYNTHETIC_FORMING,'1h','4h',5*hour));
  const prefix = SYNTHETIC_FORMING.slice(0,5);
  const first = formingFourHour(prefix,5*hour);
  formingFourHour(SYNTHETIC_FORMING,7*hour);
  assert.deepEqual(formingFourHour(SYNTHETIC_FORMING,5*hour), first);
  assert.deepEqual(calculateChart(aggregateBars(SYNTHETIC_FORMING,'1h','4h',5*hour)), before);
  assert.equal(before.candles.length, 1);
  assert.equal(before.overlays.patterns.some(p => p.name === 'Bullish engulfing'), false);
});

test('SYNTHETIC closed engulfing includes equal body boundaries but never a missing hour', () => {
  // SOURCE: deliberately equal synthetic body endpoints exercise the documented inclusive choice.
  const pair = [[110,100],[100,110]].map(([o,c],i) => ({
    t:i*hour,closeTime:(i+1)*hour,o,c,h:110,l:100,closed:true,
  }));
  assert.ok(calculateChart(pair).overlays.patterns.some(p => p.name === 'Bullish engulfing'));
  pair[1].t += hour; pair[1].closeTime += hour;
  assert.equal(calculateChart(pair).overlays.patterns.some(p => p.name === 'Bullish engulfing'), false);
});
