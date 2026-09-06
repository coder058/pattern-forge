import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  aggregateBars,
  calculateChart,
  ema,
  rsi,
  macd,
  validateBars,
  INTERVAL_MS,
} from "../app/marketAnalysis.ts";

// SOURCE: synthetic, deterministic mechanics fixtures, never market evidence.
const hour = INTERVAL_MS["1h"];
const fixture = (count = 80) =>
  Array.from({ length: count }, (_, i) => ({
    t: i * hour,
    closeTime: (i + 1) * hour,
    o: 100 + i,
    h: 102 + i,
    l: 99 + i,
    c: 101 + i,
    v: 10,
    closed: true,
  }));

test("validation retains only provably closed bars and rejects conflict", () => {
  const input = fixture(3);
  assert.equal(validateBars(input, "1h", 2 * hour).length, 2);
  assert.throws(
    () => validateBars([...input, { ...input[0], c: 100 }], "1h", 3 * hour),
    /Conflicting/,
  );
  assert.throws(
    () => validateBars([{ ...input[0], v: -1 }], "1h", hour),
    /volume/,
  );
  assert.throws(
    () => validateBars([{ ...input[0], h: 1 }], "1h", hour),
    /OHLC/,
  );
  assert.throws(
    () => validateBars([{ ...input[0], closeTime: 1 }], "1h", hour),
    /duration/,
  );
});
test("aggregation preserves OHLCV and excludes partial or gappy groups", () => {
  const input = fixture(9),
    groups = aggregateBars(input, "1h", "4h", 9 * hour);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], {
    t: 0,
    closeTime: 4 * hour,
    o: 100,
    h: 105,
    l: 99,
    c: 104,
    v: 40,
    closed: true,
  });
  assert.equal(
    aggregateBars(
      input.filter((_, i) => i !== 2),
      "1h",
      "4h",
      9 * hour,
    ).length,
    1,
  );
  assert.equal(aggregateBars(input, "1h", "1h", 9 * hour).length, 9);
  assert.equal(aggregateBars(input, "1h", "5m", 9 * hour).length, 0);
  assert.equal(aggregateBars(input, "1h", "4h", 3 * hour).length, 0);
});
test("aggregation never silently turns unknown volume into zero", () => {
  const input = fixture(4);
  delete input[1].v;
  assert.equal(aggregateBars(input, "1h", "4h", 4 * hour)[0].v, undefined);
});
test("EMA waits for SMA seed and applies its documented recurrence", () => {
  assert.deepEqual(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(ema([1, 2], 3), [null, null]);
});
test("RSI handles rising, falling and flat fixtures", () => {
  assert.ok(rsi(fixture()).every((p) => p.value === 100));
  assert.ok(
    rsi(fixture().map((b) => ({ ...b, c: 300 - b.c }))).every(
      (p) => p.value === 0,
    ),
  );
  assert.ok(
    rsi(fixture().map((b) => ({ ...b, c: 100 }))).every((p) => p.value === 50),
  );
  assert.deepEqual(rsi(fixture(14)), []);
});
test("MACD has separately warmed line, signal and histogram", () => {
  const result = macd(fixture());
  assert.equal(result.line[0].time, fixture()[25].t);
  assert.equal(result.signal[0].time, fixture()[33].t);
  assert.equal(result.histogram.length, result.signal.length);
  assert.ok(result.histogram.every((p) => Math.abs(p.value) < 1e-10));
});
test("indicators preserve prefix causality", () => {
  const full = fixture(),
    prefix = full.slice(0, 55),
    cutoff = prefix.at(-1).closeTime;
  const before = calculateChart(prefix).overlays,
    after = calculateChart(full).overlays;
  for (const key of ["ema", "emaSlow"])
    assert.deepEqual(
      before[key],
      after[key].filter((p) => p.time < cutoff),
    );
  for (const key of ["upper", "middle", "lower"])
    assert.deepEqual(
      before.bollinger[key],
      after.bollinger[key].filter((p) => p.time < cutoff),
    );
  assert.deepEqual(
    rsi(prefix),
    rsi(full).filter((p) => p.time < cutoff),
  );
  assert.deepEqual(
    macd(prefix).signal,
    macd(full).signal.filter((p) => p.time < cutoff),
  );
});
test("pattern confirmation never appears before bar close or bridges missing bars", () => {
  const input = [
    {
      t: 0,
      closeTime: hour,
      o: 110,
      h: 111,
      l: 99,
      c: 100,
      v: 1,
      closed: true,
    },
    {
      t: hour,
      closeTime: 2 * hour,
      o: 99,
      h: 112,
      l: 98,
      c: 111,
      v: 1,
      closed: true,
    },
  ];
  const patterns = calculateChart(input).overlays.patterns;
  assert.equal(
    patterns.find((p) => p.name === "Bullish engulfing").knownAt,
    2 * hour,
  );
  assert.ok(
    !calculateChart([
      { ...input[0] },
      { ...input[1], t: 2 * hour, closeTime: 3 * hour },
    ]).overlays.patterns.some((p) => p.name === "Bullish engulfing"),
  );
});
test("pivot structures require later confirmation; prefix replay has no future pivots", () => {
  const input = fixture(60).map((b, i) => {
    const c = 100 + Math.sin(i);
    return { ...b, o: c, c, h: c + 1, l: c - 1 };
  });
  const full = calculateChart(input).overlays.trendlines,
    prefix = calculateChart(input.slice(0, 35)).overlays.trendlines;
  assert.ok(full.length > 0);
  assert.deepEqual(
    prefix,
    full.filter((p) => p.confirmedAt <= 35 * hour),
  );
  assert.ok(full.every((p) => p.confirmedAt > p.endTime));
});

const catalog = JSON.parse(
  readFileSync(new URL("../public/recordings/catalog.json", import.meta.url)),
);
test("all ten public recordings validate and expose only market data", () => {
  assert.equal(catalog.length, 10);
  for (const source of catalog) {
    const document = JSON.parse(
      readFileSync(new URL(`../public${source.path}`, import.meta.url)),
    );
    const bars = validateBars(document.candles, "1h", document.metadata.asOf);
    assert.equal(bars.length, source.count);
    assert.equal(bars[0].t, source.first);
    assert.equal(bars.at(-1).closeTime, source.last);
    assert.match(source.sourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(source.finalBarOmitted, true);
    assert.deepEqual(Object.keys(document).sort(), ["candles", "metadata"]);
    assert.ok(
      bars.every((row) =>
        Object.keys(row).every((key) =>
          ["t", "closeTime", "o", "h", "l", "c", "v", "closed"].includes(key),
        ),
      ),
    );
  }
});
test("recording higher-timeframe replay contains no rows beyond the cursor", () => {
  for (const source of catalog) {
    const { candles } = JSON.parse(
      readFileSync(new URL(`../public${source.path}`, import.meta.url)),
    );
    const cutoff = candles[Math.floor(candles.length / 2)].closeTime;
    for (const interval of ["4h", "1d"]) {
      const aggregate = aggregateBars(candles, "1h", interval, cutoff);
      assert.ok(aggregate.every((bar) => bar.closeTime <= cutoff));
      assert.deepEqual(
        aggregate,
        aggregateBars(
          candles.filter((b) => b.closeTime <= cutoff),
          "1h",
          interval,
          cutoff,
        ),
      );
    }
  }
});
test("saved BTC case remains a verified historical input in all supplied intervals", () => {
  const saved = JSON.parse(
    readFileSync(new URL("../public/demo-market.json", import.meta.url)),
  );
  for (const [interval, frame] of Object.entries(saved.timeframes))
    assert.ok(
      validateBars(frame.candles, interval, Date.parse(saved.asOf)).length > 0,
    );
});
