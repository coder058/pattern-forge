import test from 'node:test';
import assert from 'node:assert/strict';
import { connectQuote, readMid } from '../app/liveQuote.ts';

// SOURCE: all payloads and clocks below are SYNTHETIC protocol fixtures.
const mid = value => JSON.stringify({ channel: 'allMids', data: { mids: { BTC: value } } });
test('SYNTHETIC: malformed, wrong-channel, missing and invalid prices cannot become live', () => {
  for (const raw of ['{', '{}', mid(''), mid('-1'), mid('Infinity'), mid('NaN'), mid(null)]) assert.equal(readMid(raw, 'BTC'), undefined);
  assert.equal(readMid(mid('10'), 'ETH'), undefined);
  assert.equal(readMid(mid('10'), 'BTC'), 10);
});
test('SYNTHETIC: subscribes, clears disconnected quotes, reconnects and cleans up', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const sockets = [], states = [], sent = [];
  const connect = () => { const socket = { send: text => sent.push(JSON.parse(text)), close() { this.closed = true; } }; sockets.push(socket); return socket; };
  const stop = connectQuote('BTC', state => states.push(state), connect, () => 0);
  sockets[0].onopen();
  assert.deepEqual(sent[0], { method: 'subscribe', subscription: { type: 'allMids' } });
  sockets[0].onmessage({ data: mid('10') });
  assert.deepEqual(states.at(-1), { status: 'live', price: 10, receivedAt: 0 });
  sockets[0].onclose();
  assert.deepEqual(states.at(-1), { status: 'reconnecting' });
  // SOURCE: advance through the implementation's initial one-second retry.
  t.mock.timers.tick(1_000);
  assert.equal(sockets.length, 2);
  sockets[1].onopen();
  stop();
  assert.equal(sockets[1].closed, true);
  assert.equal(sockets[1].onmessage, null);
  t.mock.timers.tick(60_000);
  assert.equal(sockets.length, 2);
});
test('SYNTHETIC: a silent feed loses live status even if the socket stays open', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let clock = 0;
  const states = [];
  const socket = { send() {}, close() {} };
  const stop = connectQuote('BTC', state => states.push(state), () => socket, () => clock);
  socket.onopen(); socket.onmessage({ data: mid('10') });
  // SOURCE: exceed the configured quote timeout, then trigger the heartbeat check.
  clock = 60_000; t.mock.timers.tick(20_000);
  assert.equal(states.at(-1).status, 'reconnecting');
  assert.equal(states.at(-1).price, undefined);
  stop();
});
