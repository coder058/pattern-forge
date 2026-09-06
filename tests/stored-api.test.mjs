import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoredApi } from '../app/storedApi.ts';
import { STORED_BARS, STORED_INTERVALS } from '../app/storedMarket.ts';
import { INTERVAL_MS } from '../app/marketAnalysis.ts';

// SOURCE: SYNTHETIC rows and a controlled clock; no database is contacted here.
// The SQL itself is exercised by the PostgreSQL job in continuous integration.
const HOUR = INTERVAL_MS['1h'];
const url = symbol => new Request(`http://localhost/api/stored/${symbol}`);
const storedRow = openTime => ({
  interval: '1h', open_time: openTime, close_time: openTime + HOUR,
  open: 100, high: 104.5, low: 96.5, close: 101, volume: 12,
});

test('SYNTHETIC: rejects unsupported markets without touching the database', async () => {
  let calls = 0;
  const handler = createStoredApi(async () => { calls++; return []; });
  const response = await handler(url('arbitrary-table'));
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test('SYNTHETIC: asks for the selected market, the served intervals and a bounded count', async () => {
  let received;
  const handler = createStoredApi(async (text, values) => { received = { text, values }; return [storedRow(HOUR)]; });
  await handler(url('ETH'));
  assert.deepEqual(received.values, ['ETH', STORED_INTERVALS, STORED_BARS]);
  assert.match(received.text, /FROM candles/);
  assert.match(received.text, /WHERE symbol = \$1 AND interval = ANY\(\$2\)/);
});

test('SYNTHETIC: an empty store is a 404 with an instruction, not a fault', async () => {
  const handler = createStoredApi(async () => []);
  const response = await handler(url('BTC'));
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /Run the ingester/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('SYNTHETIC: stored candles are returned with counts and a measured handler time', async () => {
  let clock = 1_000;
  const handler = createStoredApi(async () => { clock += 7; return [storedRow(HOUR), storedRow(HOUR * 2)]; }, () => clock);
  const response = await handler(url('BTC'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.symbol, 'BTC');
  assert.equal(body.source, 'database');
  assert.equal(body.frames['1h'].length, 2);
  assert.deepEqual(body.stored, { '1h': 2 });
  assert.equal(body.asOf, HOUR * 3);
  assert.equal(response.headers.get('Server-Timing'), 'query;dur=7');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('SYNTHETIC: a database failure is 503 and a later request can recover', async () => {
  let offline = true;
  const handler = createStoredApi(async () => {
    if (offline) throw new Error('connection refused');
    return [storedRow(HOUR)];
  });
  assert.equal((await handler(url('SOL'))).status, 503);
  offline = false;
  const response = await handler(url('SOL'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).symbol, 'SOL');
});

test('SYNTHETIC: an unusable stored row is a fault, not a partial chart', async () => {
  const handler = createStoredApi(async () => [{ ...storedRow(HOUR), close_time: HOUR + 5 }]);
  assert.equal((await handler(url('BTC'))).status, 503);
});
