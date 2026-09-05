"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ProfessionalChart,
  type ProfessionalDrawTool,
  type ProfessionalLayerState,
} from "./ProfessionalChart";
import {
  aggregateBars,
  calculateChart,
  DEFAULT_INDICATORS,
  macd,
  rsi,
  summarize,
  type Bar,
  type Interval,
} from "./marketAnalysis";
import {
  loadMarket,
  SOURCES,
  SOURCE_INTERVALS,
  type LoadedMarket,
} from "./marketSources";
import "./workspace.css";

type Analysis = "none" | "timeframes" | "context" | "patterns" | "case";
// SOURCE: editorial defaults: uncluttered chart, optional analytical layers.
const DEFAULT_LAYERS: ProfessionalLayerState = {
  ema: true,
  bollinger: false,
  trendlines: false,
  patterns: false,
  touches: false,
  plans: false,
};
// GUESS: UNCALIBRATED GUESS — bounded network wait, not a market assumption.
const REQUEST_TIMEOUT_MS = 20000;
// GUESS: UNCALIBRATED GUESS — limits reading density only, never detector output.
const RECENT_PATTERN_LIMIT = 8;
const price = (n?: number) =>
  n === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
const stamp = (t: number) =>
  new Date(t).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

export default function MarketWorkspace() {
  const [sourceId, setSourceId] = useState("public-BTC");
  const [timeframe, setTimeframe] = useState<Interval>("5m");
  const [loaded, setLoaded] = useState<LoadedMarket | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [watchlist, setWatchlist] = useState(true);
  const [analysis, setAnalysis] = useState<Analysis>("none");
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [tool, setTool] = useState<ProfessionalDrawTool>("inspect");
  const [clearToken, setClearToken] = useState(0);
  const [replayCount, setReplayCount] = useState<number | null>(null);
  const [fastPeriod, setFastPeriod] = useState(DEFAULT_INDICATORS.fast);
  const [slowPeriod, setSlowPeriod] = useState(DEFAULT_INDICATORS.slow);
  const [lowerPanel, setLowerPanel] = useState<
    "none" | "volume" | "rsi" | "macd"
  >("volume");
  const workspaceRef = useRef<HTMLElement>(null);
  const source = SOURCES.find((s) => s.id === sourceId)!;
  const intervals = SOURCE_INTERVALS(source);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setBusy(true);
    setError("");
    setLoaded(null);
    setReplayCount(null);
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    loadMarket(source, controller.signal)
      .then((value) => {
        if (current) {
          setLoaded(value);
          // SOURCE: use an actually loaded interval; never label another frame as the failed one.
          if (source.kind === "public") setTimeframe((selected) =>
            value.frames[selected]?.length ? selected :
              SOURCE_INTERVALS(source).find((tf) => value.frames[tf]?.length) ?? selected);
        }
      })
      .catch((cause) => {
        if (current)
          setError(
            cause.name === "AbortError"
              ? "The source took too long to respond. Try Refresh or choose a recording."
              : cause.message,
          );
      })
      .finally(() => {
        clearTimeout(timeout);
        if (current) setBusy(false);
      });
    return () => {
      current = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [source, revision]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape")
        workspaceRef.current
          ?.querySelectorAll("details[open]")
          .forEach((el) => el.removeAttribute("open"));
    };
    document.addEventListener("keydown", close);
    const outside = (event: PointerEvent) => {
      workspaceRef.current?.querySelectorAll("details[open]").forEach((el) => {
        if (!el.contains(event.target as Node)) el.removeAttribute("open");
      });
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", outside);
    };
  }, []);

  const active = loaded?.id === sourceId ? loaded : null;
  const replayBase =
    active?.base ?? (source.kind === "case" ? "5m" : timeframe);
  const baseBars = active?.frames[replayBase] ?? [];
  const count =
    replayCount === null
      ? baseBars.length
      : Math.min(replayCount, baseBars.length);
  const cutoff = baseBars[count - 1]?.closeTime ?? active?.asOf ?? 0;
  const frames = useMemo(
    () =>
      Object.fromEntries(
        intervals.map((interval) => [
          interval,
          active?.base
            ? aggregateBars(
                active.frames[active.base] ?? [],
                active.base,
                interval,
                cutoff,
              )
            : (active?.frames[interval] ?? []).filter(
                (b) => b.closeTime <= cutoff,
              ),
        ]),
      ) as Partial<Record<Interval, Bar[]>>,
    [active, cutoff, sourceId],
  );
  const bars = frames[timeframe] ?? [];
  const chart = useMemo(
    () => calculateChart(bars, fastPeriod, slowPeriod),
    [bars, fastPeriod, slowPeriod],
  );
  const oscillatorData = useMemo(
    () =>
      lowerPanel === "rsi"
        ? { line: rsi(bars) }
        : lowerPanel === "macd"
          ? macd(bars)
          : undefined,
    [bars, lowerPanel],
  );
  const summary = useMemo(() => summarize(bars), [bars]);
  const last = bars.at(-1),
    first = bars[0];
  const periodChange = last && first ? (last.c / first.o - 1) * 100 : undefined;
  const filtered = SOURCES.filter((s) =>
    `${s.symbol} ${s.label} ${s.group}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selectMarket = (id: string) => {
    const next = SOURCES.find((s) => s.id === id)!;
    setSourceId(id);
    setTimeframe(next.kind === "recording" ? "1h" : "5m");
    setReplayCount(null);
    setTool("inspect");
    if (analysis === "case" && next.kind !== "case") setAnalysis("none");
  };
  const changeTimeframe = (value: Interval) => {
    setTimeframe(value);
    if (source.kind === "public") setReplayCount(null);
  };
  const toggle = (layer: keyof ProfessionalLayerState) =>
    setLayers((value) => ({ ...value, [layer]: !value[layer] }));
  const exportData = () => {
    const document = {
      source: {
        symbol: source.symbol,
        venue: source.venue,
        kind: source.kind,
        note: source.note,
        sourceSha256: source.sourceSha256,
      },
      asOf: active?.asOf,
      replayCutoff: cutoff,
      interval: timeframe,
      candles: bars,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(document, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${source.symbol}-${timeframe}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="market-workspace" ref={workspaceRef}>
      <section className="mw-intro" aria-labelledby="pattern-forge-title">
        <h1 id="pattern-forge-title">Pattern Forge</h1>
        <div>
          <p>A chart workspace for comparing markets and replaying price history. Indicators use only the candles visible at each step, so later prices cannot change what you saw earlier.</p>
          <p>Choose a market and a timeframe below. For a recording, move the Replay slider back, then step forward through the candles. Public markets load a snapshot when you select or refresh them.</p>
        </div>
      </section>
      <header className="mw-header" id="workspace">
        <a className="mw-brand" href="#pattern-forge-title">
          Pattern Forge<span>Market workspace</span>
        </a>
        <p>Charts and recorded-market replay</p>
      </header>
      <div className="mw-toolbar">
        <button
          className={watchlist ? "is-active" : ""}
          aria-label="Toggle markets"
          aria-pressed={watchlist}
          onClick={() => setWatchlist(!watchlist)}
        >
          ☷ Markets
        </button>
        <label className="mw-symbol">
          <span className="sr-only">Market</span>
          <select
            value={sourceId}
            onChange={(e) => selectMarket(e.target.value)}
          >
            {[...new Set(SOURCES.map((s) => s.group))].map((group) => (
              <optgroup label={group} key={group}>
                {SOURCES.filter((s) => s.group === group).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.kind === "public" ? "Public " : ""}
                    {s.symbol} · {s.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div
          className="mw-timeframes"
          role="group"
          aria-label="Chart timeframe"
        >
          {intervals.map((tf) => (
            <button
              key={tf}
              onClick={() => changeTimeframe(tf)}
              disabled={!!active?.failures?.[tf]}
              title={active?.failures?.[tf] ? `${tf} unavailable. Try Refresh.` : undefined}
              aria-pressed={tf === timeframe}
              className={tf === timeframe ? "is-active" : ""}
            >
              {tf}
            </button>
          ))}
        </div>
        <details className="mw-menu">
          <summary>
            Indicators <span>⌄</span>
          </summary>
          <div className="mw-popover">
            <h2>On the price chart</h2>
            <label>
              <input
                type="checkbox"
                checked={layers.ema}
                onChange={() => toggle("ema")}
              />
              Moving averages
            </label>
            <p>Smooth closing prices to make direction easier to read.</p>
            <div className="mw-periods">
              <label>
                Fast
                <select
                  aria-label="Fast EMA period"
                  value={fastPeriod}
                  onChange={(e) => setFastPeriod(Number(e.target.value))}
                >
                  {[9, 20, 50].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label>
                Slow
                <select
                  aria-label="Slow EMA period"
                  value={slowPeriod}
                  onChange={(e) => setSlowPeriod(Number(e.target.value))}
                >
                  {[26, 50, 100, 200].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={layers.bollinger}
                onChange={() => toggle("bollinger")}
              />
              Bollinger Bands · 20, 2
            </label>
            <p>A moving average with bands two standard deviations away.</p>
            <label>
              <input
                type="checkbox"
                checked={layers.trendlines}
                onChange={() => toggle("trendlines")}
              />
              Swing structure
            </label>
            <p>
              Connects confirmed pivots. Uses three later bars; exploratory, not
              a forecast.
            </p>
            <label>
              <input
                type="checkbox"
                checked={layers.patterns}
                onChange={() => toggle("patterns")}
              />
              Candlestick markers
            </label>
            <p>Geometric shapes only. Read their meaning under Analysis.</p>
          </div>
        </details>
        <label className="mw-analysis-select">
          Analysis
          <select
            aria-label="Analysis panel"
            value={analysis}
            onChange={(e) => setAnalysis(e.target.value as Analysis)}
          >
            <option value="none">Hidden</option>
            <option value="timeframes">Compare timeframes</option>
            <option value="context">Trend & location · Murphy</option>
            <option value="patterns">Candlestick patterns</option>
            {source.kind === "case" && (
              <option value="case">Saved case explained</option>
            )}
          </select>
        </label>
        <button onClick={() => setRevision((n) => n + 1)} disabled={busy}>
          ↻ Refresh
        </button>
        <details className="mw-menu mw-help">
          <summary aria-label="Help and source details">?</summary>
          <div className="mw-popover">
            <h2>How to use this workspace</h2>
            <p>
              Choose a market, set an interval, then add only the indicators you
              need. Drag to pan, scroll to zoom. Historical markets can be
              rewound with Replay.
            </p>
            <h3>Lower indicator pane</h3>
            <p>
              Volume shows traded size per candle. RSI compares recent gains and
              losses. MACD compares two moving averages with a smoothed signal
              line; its histogram shows their difference. These are descriptive
              tools, not entry rules.
            </p>
            <h3>Current source</h3>
            <p>
              {source.venue} ·{" "}
              {source.kind === "public"
                ? "Manual snapshot of public closed candles. Not streaming."
                : source.note}
            </p>
            {source.kind === "recording" && (
              <p>
                {source.count?.toLocaleString()} hourly candles · {source.gaps}{" "}
                gaps. Recorded in Google Cloud; missing hours are not filled.
                Higher intervals require every underlying hour.
              </p>
            )}
            <p>
              All timestamps are UTC. Indicators describe history; no trading
              account or order submission is connected.
            </p>
            <button onClick={exportData} disabled={!bars.length}>
              Export loaded candles JSON ↓
            </button>
          </div>
        </details>
      </div>
      <div
        className={`mw-body ${watchlist ? "with-markets" : ""} ${analysis !== "none" ? "with-analysis" : ""}`}
      >
        {watchlist && (
          <aside className="mw-markets" aria-label="Markets">
            <div className="mw-sidebar-title">
              <h2>Markets</h2>
              <span>{SOURCES.length}</span>
            </div>
            <input
              type="search"
              aria-label="Search markets"
              placeholder="Search markets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {[...new Set(filtered.map((s) => s.group))].map((group) => (
              <section key={group}>
                <h3>{group}</h3>
                {filtered
                  .filter((s) => s.group === group)
                  .map((s) => (
                    <button
                      key={s.id}
                      onClick={() => selectMarket(s.id)}
                      aria-pressed={s.id === sourceId}
                      className={s.id === sourceId ? "selected" : ""}
                    >
                      <span>
                        <strong>
                          {s.kind === "public" ? `Public ${s.symbol}` : s.label}
                        </strong>
                        <small>
                          {s.kind === "case"
                            ? "28 Jul · invalidated breakout"
                            : s.symbol}
                        </small>
                      </span>
                      <em>
                        {s.kind === "public"
                          ? "Snapshot"
                          : s.kind === "case"
                            ? "Case"
                            : "Replay"}
                      </em>
                    </button>
                  ))}
              </section>
            ))}
            {!filtered.length && <p>No matching market.</p>}
          </aside>
        )}
        <section className="mw-chart-panel" aria-label="Market chart">
          <div className="mw-chart-heading">
            <div>
              <h2>
                {source.label}{" "}
                <span>
                  {source.symbol} · {timeframe}
                </span>
              </h2>
              <p>
                {source.venue}{" "}
                <span
                  className={`mw-badge ${source.kind === "public" ? "" : "archive"}`}
                >
                  {source.kind === "public"
                    ? "Public snapshot"
                    : "Historical recording"}
                </span>
              </p>
            </div>
            <div className="mw-price">
              <strong>{busy ? "—" : price(last?.c)}</strong>
              {periodChange !== undefined && !busy && (
                <span className={periodChange >= 0 ? "positive" : "negative"}>
                  {periodChange >= 0 ? "+" : ""}
                  {periodChange.toFixed(2)}% <small>loaded range</small>
                </span>
              )}
            </div>
          </div>
          {active?.failures && Object.keys(active.failures).length > 0 && (
            <p className="mw-partial-warning" role="status">
              Unavailable intervals: {Object.keys(active.failures).join(", ")}. Showing available data only. Try Refresh to retry.
            </p>
          )}
          <div className="mw-chart-tools">
            <label>
              Draw
              <select
                aria-label="Drawing tool"
                value={tool}
                onChange={(e) =>
                  setTool(e.target.value as ProfessionalDrawTool)
                }
              >
                <option value="inspect">Crosshair</option>
                <option value="trend">Trendline</option>
                <option value="horizontal">Horizontal level</option>
                <option value="measure">Measure</option>
              </select>
            </label>
            <button onClick={() => setClearToken((n) => n + 1)}>
              Clear drawings
            </button>
            <label>
              Lower pane
              <select
                aria-label="Lower indicator pane"
                value={lowerPanel}
                onChange={(e) =>
                  setLowerPanel(e.target.value as typeof lowerPanel)
                }
              >
                <option value="none">Hidden</option>
                <option value="volume">Volume</option>
                <option value="rsi">RSI · 14</option>
                <option value="macd">MACD · 12, 26, 9</option>
              </select>
            </label>
            <div className="mw-legend">
              {layers.ema && (
                <span className="ema">
                  EMA {fastPeriod} / {slowPeriod}
                </span>
              )}
              {layers.bollinger && <span className="bands">BB 20 / 2</span>}
              {layers.patterns && <span>Patterns</span>}
              {layers.trendlines && <span>Swings</span>}
            </div>
          </div>
          <div className="mw-chart-canvas">
            {busy ? (
              <div className="mw-empty" role="status">
                Loading {source.label}…
              </div>
            ) : error ? (
              <div className="mw-empty" role="alert">
                <h2>Data unavailable</h2>
                <p>{error}</p>
                <button onClick={() => setRevision((n) => n + 1)}>
                  Try again
                </button>
              </div>
            ) : !bars.length ? (
              <div className="mw-empty">
                <h2>No complete {timeframe} candles here</h2>
                <p>
                  Move the replay forward or select a smaller interval. Missing
                  bars are never invented.
                </p>
              </div>
            ) : (
              <ProfessionalChart
                key={sourceId}
                data={chart}
                timeframe={timeframe}
                layers={layers}
                tool={tool}
                clearToken={clearToken}
                symbol={source.symbol}
                lowerPanel={lowerPanel}
                oscillatorData={oscillatorData}
              />
            )}
          </div>
          {source.kind !== "public" && baseBars.length > 0 && (
            <div className="mw-replay">
              <span>Replay · {replayBase}</span>
              <button
                aria-label="Previous replay candle"
                disabled={count <= 1}
                onClick={() => setReplayCount(count - 1)}
              >
                ‹
              </button>
              <input
                aria-label="Replay position"
                type="range"
                min={1}
                max={baseBars.length}
                value={count}
                onChange={(e) => setReplayCount(Number(e.target.value))}
              />
              <button
                aria-label="Next replay candle"
                disabled={count >= baseBars.length}
                onClick={() => setReplayCount(count + 1)}
              >
                ›
              </button>
              <button onClick={() => setReplayCount(null)}>End</button>
              <time>{stamp(cutoff)} UTC</time>
            </div>
          )}
          <footer className="mw-chart-footer">
            <span>
              {busy
                ? "Fetching…"
                : error
                  ? "Source unavailable"
                  : `${bars.length.toLocaleString()} closed bars · ${last ? stamp(last.closeTime) : "—"} UTC`}
            </span>
            <button onClick={exportData} disabled={!bars.length}>
              Export ↓
            </button>
          </footer>
        </section>
        {analysis !== "none" && (
          <aside className="mw-analysis" aria-label="Analysis">
            <div className="mw-sidebar-title">
              <h2>
                {analysis === "timeframes"
                  ? "Timeframes"
                  : analysis === "context"
                    ? "Trend & location"
                    : analysis === "patterns"
                      ? "Candle patterns"
                      : "Saved BTC case"}
              </h2>
              <button
                aria-label="Close analysis"
                onClick={() => setAnalysis("none")}
              >
                ×
              </button>
            </div>
            {busy || error ? (
              <p>Load a market to inspect its analysis.</p>
            ) : analysis === "timeframes" ? (
              <>
                <p>
                  Compare the same market at different speeds. Direction
                  compares the close with EMA 20 and EMA 50; it is not a
                  buy/sell recommendation.
                </p>
                <div className="mw-matrix">
                  {intervals.map((tf) => {
                    const row = summarize(frames[tf] ?? []);
                    return (
                      <button
                        key={tf}
                        onClick={() => changeTimeframe(tf)}
                        disabled={!!active?.failures?.[tf]}
                        className={timeframe === tf ? "selected" : ""}
                      >
                        <strong>{tf}</strong>
                        <span>
                          {active?.failures?.[tf] ? "Unavailable" : row.trend}
                          <small>
                            {row.count} bars · RSI {row.rsi?.toFixed(1) ?? "—"}
                          </small>
                        </span>
                        <b>{price(row.last?.c)}</b>
                      </button>
                    );
                  })}
                </div>
                <p className="mw-note">
                  Only bars closed by the replay cursor are included. Higher
                  intervals with missing hours are omitted.
                </p>
              </>
            ) : analysis === "context" ? (
              <>
                <p>
                  A simple reading order inspired by John J. Murphy: direction
                  first, then price location and momentum. No combined score.
                </p>
                <article>
                  <h3>01 / Direction</h3>
                  <strong>{summary.trend}</strong>
                  <p>
                    Rising: close above EMA 20 above EMA 50. Falling: the
                    reverse. Mixed: the averages and price disagree.
                  </p>
                </article>
                <article>
                  <h3>02 / Location</h3>
                  <strong>
                    {!last || !chart.overlays.bollinger.upper.length
                      ? "Needs 20 bars"
                      : last.c > chart.overlays.bollinger.upper.at(-1)!.value
                        ? "Above upper band"
                        : last.c < chart.overlays.bollinger.lower.at(-1)!.value
                          ? "Below lower band"
                          : "Inside Bollinger Bands"}
                  </strong>
                  <p>
                    Position within the recent closing-price distribution.
                    Outside a band does not by itself imply a reversal.
                  </p>
                </article>
                <article>
                  <h3>03 / Momentum</h3>
                  <strong>RSI {summary.rsi?.toFixed(1) ?? "—"}</strong>
                  <p>
                    Wilder RSI (14) compares recent gains with losses on a 0–100
                    scale. A high value is not an automatic sell.
                  </p>
                </article>
                <p className="mw-note">
                  Descriptive context, not a complete implementation of Murphy’s
                  framework or a calibrated strategy.
                </p>
              </>
            ) : analysis === "patterns" ? (
              <>
                <p>
                  Shapes formed by closed candles. They describe the candle body
                  and wicks, not what price will do next.
                </p>
                <label className="mw-marker-toggle">
                  <input
                    type="checkbox"
                    checked={layers.patterns}
                    onChange={() => toggle("patterns")}
                  />
                  Show markers on chart
                </label>
                {chart.overlays.patterns
                  .slice()
                  .reverse()
                  .slice(0, RECENT_PATTERN_LIMIT)
                  .map((pattern, i) => (
                    <article key={`${pattern.time}-${i}`}>
                      <h3>{pattern.name}</h3>
                      <time>{stamp(Number(pattern.time))}</time>
                      <p>{pattern.variant}</p>
                    </article>
                  ))}
                {!chart.overlays.patterns.length && (
                  <p>No matching shapes in this slice.</p>
                )}
                <details>
                  <summary>Detector definitions</summary>
                  <p>
                    Doji: body ≤ 10% of range. Hammer/star: long wick ≥ 2× body,
                    opposite wick ≤ body. Engulfing: current body contains the
                    preceding opposite body. These thresholds are uncalibrated;
                    shapes do not establish an edge.
                  </p>
                </details>
              </>
            ) : (
              <>
                <p>28 July 2026 · BTC / 5m</p>
                <h3>A breakout that did not hold</h3>
                <p>
                  The stored example broke a prior resistance line, retested it,
                  then closed back below it. It is retained as a failed setup,
                  not a success story.
                </p>
                <p>
                  Use Replay to inspect the sequence around 19:00–19:10 UTC. No
                  paper return, execution or target hit is inferred from the
                  chart.
                </p>
              </>
            )}
          </aside>
        )}
      </div>
    </main>
  );
}
