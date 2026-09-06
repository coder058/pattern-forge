import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketApi, SNAPSHOT_CACHE_MS } from '../app/marketApi.ts';
import { INTERVAL_MS } from '../app/marketAnalysis.ts';

// SOURCE: SYNTHETIC closed candle and controlled clock; not observations or a benchmark.
const asOf = INTERVAL_MS['1d'];
const url = symbol => new Request(`http://localhost/api/markets/${symbol}`);
const syntheticResponse = options => {
  const interval = JSON.parse(options.body).req.interval;
  return Response.json([{ t: 0, T: INTERVAL_MS[interval] - 1, o: '10', h: '12', l: '9', c: '11', v: '5' }]);
};

test('SYNTHETIC: rejects unsupported markets without requesting an upstream', async () => {
  let calls = 0;
  const handler = createMarketApi(async () => { calls++; throw Error(); });
  assert.equal((await handler(url('arbitrary-host'))).status, 400);
  assert.equal(calls, 0);
});
test('SYNTHETIC: concurrent requests share upstream work and cache expires', async () => {
  let calls = 0, clock = asOf;
  const handler = createMarketApi(async (_, options) => { calls++; return syntheticResponse(options); }, () => clock);
  const [a, b] = await Promise.all([handler(url('BTC')), handler(url('BTC'))]);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(calls, Object.keys(INTERVAL_MS).filter(tf => ['5m', '30m', '1h', '4h', '1d'].includes(tf)).length);
  const count = calls;
  assert.equal((await handler(url('BTC'))).headers.get('X-Snapshot-Cache'), 'hit');
  assert.equal(calls, count);
  clock += SNAPSHOT_CACHE_MS;
  assert.equal((await handler(url('BTC'))).headers.get('X-Snapshot-Cache'), 'miss');
  assert.equal(calls, count * 2);
});
test('SYNTHETIC: failure is 503, then a later request can recover', async () => {
  let offline = true;
  const handler = createMarketApi(async (_, options) => {
    if (offline) throw Error('upstream down');
    return syntheticResponse(options);
  }, () => asOf);
  assert.equal((await handler(url('SOL'))).status, 503);
  offline = false;
  const response = await handler(url('SOL'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).symbol, 'SOL');
});
test('SYNTHETIC: partial data keeps interval errors and is retried, not cached', async () => {
  let failed = true;
  const handler = createMarketApi(async (_, options) =>
    failed && JSON.parse(options.body).req.interval === '5m'
      ? new Response('', { status: 503 }) : syntheticResponse(options), () => asOf);
  const first = await (await handler(url('ETH'))).json();
  assert.equal(first.failures['5m'], 'HTTP 503');
  assert.equal(first.frames['5m'], undefined);
  failed = false;
  const second = await handler(url('ETH'));
  assert.equal(second.headers.get('X-Snapshot-Cache'), 'miss');
  assert.equal((await second.json()).frames['5m'].length, 1);
});
