import test from 'node:test';
import assert from 'node:assert/strict';
import { closedPublicCandles } from '../app/publicMarket.ts';

// SOURCE: deliberately synthetic mechanics fixtures, not observations or trading results.
const interval = 300_000;
const candle = (t = 0, extra = {}) => ({ t, T: t + interval - 1, o: '10', h: '12', l: '9', c: '11', v: '5', ...extra });

test('only elapsed candles survive even if exchange sends a closed flag', () => {
  const rows = closedPublicCandles([candle(), candle(interval, { closed: true })], interval, interval);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].closeTime, interval);
  assert.equal(rows[0].c, 11);
});
test('exact inclusive close timestamp is not closed until the following millisecond', () => {
  assert.throws(() => closedPublicCandles([candle()], interval - 1, interval), /No provably closed/);
});
test('deduplicates identical bars and sorts chronologically', () => {
  assert.deepEqual(closedPublicCandles([candle(interval), candle(), candle()], interval * 2, interval).map(r => r.t), [0, interval]);
});
test('conflicting duplicate bars are rejected', () => {
  assert.throws(() => closedPublicCandles([candle(), candle(0, { c: '10' })], interval, interval), /Conflicting/);
});
test('invalid pricesintervals and OHLC bounds fail explicitly', () => {
  for (const extra of [{ c: 'NaN' }, { l: '13' }, { h: '8' }, { v: '-1' }, { T: 9 }, { t: '0' }, { o: null }])
    assert.throws(() => closedPublicCandles([candle(0, extra)], interval, interval));
});
test('malformed or empty responses never become a successful snapshot', () => {
  for (const value of [null, {}, [], [null]]) assert.throws(() => closedPublicCandles(value, interval, interval));
});
test('later forming bars cannot alter an earlier closed prefix', () => {
  const prefix = closedPublicCandles([candle()], interval, interval);
  assert.deepEqual(closedPublicCandles([candle(), candle(interval, { c: '999' })], interval, interval), prefix);
});
