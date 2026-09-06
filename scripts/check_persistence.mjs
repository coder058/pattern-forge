/** Read persisted candles through the real route handler, in a fresh process.
 *
 * The ingester wrote the rows in an earlier process that has already exited, so
 * anything this script can see came out of PostgreSQL. It also puts the stored
 * frames through the same validation and replay aggregation the chart uses,
 * because rows that the chart would reject are not usable evidence.
 *
 *   DATABASE_URL=... node scripts/check_persistence.mjs [expectedHourlyBars]
 */
import assert from 'node:assert/strict';
import { candleQuery, closeCandlePool } from '../app/db.ts';
import { createStoredApi } from '../app/storedApi.ts';
import { aggregateBars, validateBars } from '../app/marketAnalysis.ts';

const expectedHourly = Number(process.argv[2] ?? 48);
const handler = createStoredApi(candleQuery);
const request = symbol => new Request(`http://localhost/api/stored/${symbol}`);
const checks = [];
const check = async (name, assertion) => { await assertion(); checks.push(name); };

try {
  const response = await handler(request('BTC'));
  assert.equal(response.status, 200, 'stored BTC candles should be readable');
  const body = await response.json();

  await check('rows come from the database', () => {
    assert.equal(body.source, 'database');
    assert.equal(body.symbol, 'BTC');
    assert.equal(body.stored['1h'], expectedHourly);
  });

  await check('a handler time was measured', () => {
    assert.match(response.headers.get('Server-Timing'), /^query;dur=\d+$/);
  });

  const bars = validateBars(body.frames['1h'], '1h', body.asOf);
  await check('stored frames pass the chart validation unchanged', () => {
    assert.equal(bars.length, expectedHourly);
    const openings = bars.map(bar => bar.t);
    assert.deepEqual(openings, [...openings].sort((a, b) => a - b));
  });

  await check('a replay prefix never aggregates a later candle', () => {
    const prefix = bars.slice(0, 12);
    const cutoff = prefix.at(-1).closeTime;
    const aggregated = aggregateBars(prefix, '1h', '4h', cutoff);
    assert.ok(aggregated.length > 0, 'the prefix should form at least one higher-timeframe bar');
    assert.ok(aggregated.every(bar => bar.closeTime <= cutoff));
    const wholePeriod = aggregateBars(bars, '1h', '4h', cutoff);
    assert.deepEqual(aggregated, wholePeriod, 'the cutoff, not the input length, decides the result');
  });

  await check('an unlisted market is still refused', async () => {
    assert.equal((await handler(request('candles'))).status, 400);
  });

  for (const name of checks) console.log(`ok  ${name}`);
  console.log(`\n${checks.length} persistence checks passed against PostgreSQL.`);
} finally {
  await closeCandlePool();
}
