import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/MarketWorkspace.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/workspace.css', import.meta.url), 'utf8');

test('introduction explains how to start and distinguishes snapshots from recordings', () => {
  assert.match(workspace, /Choose a market and a timeframe below/);
  assert.match(workspace, /Public quotes update automatically; Refresh reloads the chart’s closed candles/);
  assert.match(workspace, /move the Replay slider back/);
  // SOURCE: one page title; the chart uses a subordinate section heading.
  assert.equal((workspace.match(/<h1\b/g) ?? []).length, 1);
  assert.match(workspace, /Open BTC 5m/);
  assert.match(workspace, /SOURCE_INTERVALS\(next\)\[0\]/);
  assert.match(workspace, /interval === active.base/);
  assert.doesNotMatch(workspace, /kind === "recording" \? "1h"/);
});

test('introduction has no viewport-height gate and controls expose keyboard focus', () => {
  const intro = css.match(/\.mw-intro \{([^}]+)\}/)?.[1];
  assert.ok(intro);
  assert.doesNotMatch(intro, /min-height/);
  assert.match(css, /\.market-workspace button:focus-visible/);
});
