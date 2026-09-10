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
  assert.match(workspace, /chooseAnalysis/);
  assert.match(workspace, /ema: next === "context"/);
  assert.match(workspace, /bollinger: next === "context"/);
  assert.match(workspace, /Murphy reading/);
  assert.doesNotMatch(workspace, /kind === "recording" \? "1h"/);
});

test('plot uses an explicit grid area independently of optional reading and evidence', () => {
  const globals = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(globals, /\.professional-chart-stage \{\s*grid-area: plot/);
  assert.match(css, /grid-template-areas: "controls" "reading" "plot" "evidence"/);
  assert.match(css, /grid-area: reading/);
  assert.match(css, /grid-area: evidence/);
});

test('setup selection draws overlays and public UI excludes an unconfigured database', () => {
  assert.match(workspace, /drawn automatically on the chart/);
  assert.match(workspace, /aria-label="Candlestick pattern"/);
  assert.match(workspace, /storedEnabled \|\| s.kind !== "stored"/);
  assert.match(workspace, /Open saved BTC recording/);
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /storedEnabled=\{Boolean\(process.env.DATABASE_URL\)\}/);
});

test('introduction has no viewport-height gate and controls expose keyboard focus', () => {
  const intro = css.match(/\.mw-intro \{([^}]+)\}/)?.[1];
  assert.ok(intro);
  assert.doesNotMatch(intro, /min-height/);
  assert.match(css, /\.market-workspace button:focus-visible/);
});
