import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPublicSnapshot } from '../app/publicSnapshot.ts';
import { INTERVAL_MS } from '../app/marketAnalysis.ts';

// SOURCE: synthetic HTTP fixtures for failure handling, not market observations.
const asOf = INTERVAL_MS['1d'];
const intervals = ['5m', '30m', '1h'];
const responseFor = (interval) => new Response(JSON.stringify([
  { t: 0, T: INTERVAL_MS[interval] - 1, o: '10', h: '12', l: '9', c: '11', v: '5' },
]));

test('a failed interval preserves successful frames and identifies the missing one', async () => {
  const calls = [];
  const request = async (_, options) => {
    const { req } = JSON.parse(options.body);
    calls.push(req.interval);
    return req.interval === '5m' ? new Response('', { status: 503 }) : responseFor(req.interval);
  };
  const result = await loadPublicSnapshot('BTC', intervals, new AbortController().signal, asOf, request);
  assert.deepEqual(calls, intervals);
  assert.deepEqual(Object.keys(result.frames), ['30m', '1h']);
  assert.equal(result.frames['30m'][0].c, 11);
  assert.deepEqual(result.failures, { '5m': 'HTTP 503' });
  assert.equal(result.asOf, asOf);
});

test('a malformed interval cannot become a successful frame', async () => {
  const request = async (_, options) => {
    const interval = JSON.parse(options.body).req.interval;
    return interval === '5m' ? new Response(JSON.stringify([{ broken: true }])) : responseFor(interval);
  };
  const result = await loadPublicSnapshot('ETH', intervals, new AbortController().signal, asOf, request);
  assert.equal(result.frames['5m'], undefined);
  assert.match(result.failures['5m'], /timestamp/);
  assert.equal(result.frames['1h'].length, 1);
});

test('all failed requests report an outage instead of empty successful data', async () => {
  await assert.rejects(loadPublicSnapshot('SOL', intervals, new AbortController().signal, asOf,
    async () => { throw new Error('offline'); }), /No public timeframes/);
});

test('timeout retains completed intervals but labels aborted intervals', async () => {
  const controller = new AbortController();
  const request = async (_, options) => {
    const interval = JSON.parse(options.body).req.interval;
    if (interval === '5m') return responseFor(interval);
    controller.abort();
    throw controller.signal.reason;
  };
  const result = await loadPublicSnapshot('BTC', intervals, controller.signal, asOf, request);
  assert.deepEqual(Object.keys(result.frames), ['5m']);
  assert.deepEqual(Object.keys(result.failures), ['30m', '1h']);
});
