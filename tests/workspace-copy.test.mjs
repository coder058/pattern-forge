import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/MarketWorkspace.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/workspace.css', import.meta.url), 'utf8');
const about = readFileSync(new URL('../app/about/page.tsx', import.meta.url), 'utf8');

test('the product opens on a chart that always loads, with patterns marked', () => {
  // SOURCE: 9 October redesign: chart first; a recording cannot fail like a live feed.
  assert.match(workspace, /const DEFAULT_SOURCE = "recorded-XAUUSD"/);
  assert.match(workspace, /patterns: true/);
  assert.doesNotMatch(workspace, /<ProjectGuide/);
  assert.doesNotMatch(workspace, /<table/);
  // SOURCE: one page title; the chart uses a subordinate section heading.
  assert.equal((workspace.match(/<h1\b/g) ?? []).length, 1);
});

test('replay and analysis keep the no-hindsight rules', () => {
  assert.match(workspace, /interval === active.base/);
  assert.match(workspace, /b\.closeTime <= cutoff/);
  assert.match(workspace, /focusedPatternTime/);
  assert.match(workspace, /Murphy reading/);
  assert.match(workspace, /SOURCE_INTERVALS\(next\)/);
  assert.match(workspace, /Replay — later candles hidden/);
  assert.doesNotMatch(workspace, /kind === "recording" \? "1h"/);
});

test('plot uses an explicit grid area independently of optional reading and evidence', () => {
  const globals = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(globals, /\.professional-chart-stage \{\s*grid-area: plot/);
  assert.match(css, /grid-template-areas: "controls" "reading" "plot" "evidence"/);
  assert.match(css, /grid-area: reading/);
  assert.match(css, /grid-area: evidence/);
});

test('failures point to a working recording and the public UI excludes an unconfigured database', () => {
  assert.match(workspace, /Open the Gold recording/);
  assert.match(workspace, /storedEnabled \|\| s.kind !== "stored"/);
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /storedEnabled=\{Boolean\(process.env.DATABASE_URL\)\}/);
});

test('controls expose keyboard focus and shortcuts', () => {
  assert.match(css, /\.market-workspace button:focus-visible/);
  assert.match(workspace, /event\.key === "\/"/);
  assert.match(workspace, /event\.key === " "/);
});

test('walkthrough explains real database boundaries and links implementation evidence', () => {
  const guide = readFileSync(new URL('../app/ProjectGuide.tsx', import.meta.url), 'utf8');
  const schema = readFileSync(new URL('../ingest/schema.sql', import.meta.url), 'utf8');
  assert.match(about, /<ProjectGuide open \/>/);
  assert.match(about, /Problem and solution/);
  assert.match(about, /catalog\.length/);
  for (const table of ['candles', 'ingest_runs']) {
    assert.ok(guide.includes(`<code>${table}</code>`));
    assert.ok(schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(guide, /public demo does not serve this database/);
  assert.match(guide, /no foreign key/);
  assert.match(guide, /not an immutable revision ledger/);
  assert.match(guide, /commit separately/);
  assert.match(guide, /double precision/);
  assert.match(guide, /aria-label="Component dependencies"/);
});
