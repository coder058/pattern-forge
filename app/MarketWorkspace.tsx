"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ProfessionalChart,
  type ChartReading,
  type ProfessionalDrawTool,
  type ProfessionalLayerState,
} from "./ProfessionalChart";
import {
  aggregateBars,
  formingFourHour,
  calculateChart,
  DEFAULT_INDICATORS,
  macd,
  murphyReading,
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
import { LiveQuote } from "./QuoteTicker";
import { ProjectGuide } from "./ProjectGuide";

type Analysis = "none" | "timeframes" | "context" | "patterns" | "case" | "ema" | "bands" | "swings";
// SOURCE: detector names implemented in marketAnalysis.calculateChart.
const PATTERN_NAMES = ["Doji", "Hammer shape", "Shooting-star shape", "Bullish engulfing", "Bearish engulfing"];
// SOURCE: editorial defaults: uncluttered chart, optional analytical layers.
const DEFAULT_LAYERS: ProfessionalLayerState = {
  ema: false,
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

export default function MarketWorkspace({ storedEnabled = false }: { storedEnabled?: boolean }) {
  const [sourceId, setSourceId] = useState("public-BTC");
  const [timeframe, setTimeframe] = useState<Interval>("5m");
  const [loaded, setLoaded] = useState<LoadedMarket | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [watchlist, setWatchlist] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis>("none");
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [tool, setTool] = useState<ProfessionalDrawTool>("inspect");
  const [clearToken, setClearToken] = useState(0);
  const [replayCount, setReplayCount] = useState<number | null>(null);
  const [fastPeriod, setFastPeriod] = useState(DEFAULT_INDICATORS.fast);
  const [slowPeriod, setSlowPeriod] = useState(DEFAULT_INDICATORS.slow);
  const [highlightTime, setHighlightTime] = useState<number | null>(null);
  const [patternName, setPatternName] = useState("Bullish engulfing");
  const [previewForming, setPreviewForming] = useState(false);
  const [lowerPanel, setLowerPanel] = useState<
    "none" | "volume" | "rsi" | "macd"
  >("none");
  const workspaceRef = useRef<HTMLElement>(null);
  const source = SOURCES.find((s) => s.id === sourceId)!;
  const availableSources = SOURCES.filter((s) => storedEnabled || s.kind !== "stored");
  // SOURCE: counts come from the same catalog as the market selector, not a marketing total.
  const publicMarkets = availableSources.filter((s) => s.kind === "public");
  const recordings = availableSources.filter((s) => s.kind === "recording");
  const savedCases = availableSources.filter((s) => s.kind === "case");
  const intervals = useMemo(() => SOURCE_INTERVALS(source), [source]);

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
          setTimeframe((selected) => {
            const allowed = SOURCE_INTERVALS(source);
            const has = (tf: Interval) =>
              (value.frames[tf]?.length ?? 0) > 0 ||
              (value.base === tf && (value.frames[value.base]?.length ?? 0) > 0);
            if (has(selected)) return selected;
            return (
              allowed.find(has) ??
              (value.base && has(value.base) ? value.base : undefined) ??
              allowed[0] ??
              selected
            );
          });
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
        intervals.map((interval) => {
          const native = (active?.frames[interval] ?? []).filter(
            (b) => b.closeTime <= cutoff,
          );
          if (!active?.base || interval === active.base) return [interval, native];
          return [
            interval,
            aggregateBars(
              active.frames[active.base] ?? [],
              active.base,
              interval,
              cutoff,
            ),
          ];
        }),
      ) as Partial<Record<Interval, Bar[]>>,
    [active, cutoff, intervals],
  );
  const bars = frames[timeframe] ?? [];
  const canPreview = source.kind === "recording" && replayBase === "1h" && timeframe === "4h" &&
    analysis === "patterns" && (patternName === "all" || patternName.endsWith("engulfing"));
  const showingForming = canPreview && previewForming;
  const provisional = useMemo(() => showingForming ? formingFourHour(baseBars, cutoff) : null,
    [showingForming, baseBars, cutoff]);
  const chart = useMemo(
    () => {
      const result = calculateChart(bars, fastPeriod, slowPeriod);
      if (patternName !== "all") result.overlays.patterns = result.overlays.patterns.filter(p => p.name === patternName);
      return result;
    },
    [bars, fastPeriod, slowPeriod, patternName],
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
  const murphy = useMemo(() => murphyReading(bars, fastPeriod, slowPeriod), [bars, fastPeriod, slowPeriod]);
  const last = bars.at(-1),
    first = bars[0];
  const latestPatternTime = chart.overlays.patterns.at(-1)?.time;
  // SOURCE: a selection must belong to this replay prefix; otherwise use its latest match.
  const focusedPatternTime = analysis === "patterns" && !showingForming
    ? (chart.overlays.patterns.some(p => Number(p.time) === highlightTime)
      ? highlightTime : latestPatternTime === undefined ? null : Number(latestPatternTime))
    : null;
  const visibleLayers = useMemo(() => ({ ...layers,
    patterns: showingForming ? false : analysis === "patterns" || layers.patterns,
  }), [analysis, layers, showingForming]);
  const displayedPatterns = useMemo(
    () => {
      const time = focusedPatternTime;
      return chart.overlays.patterns.filter((p) => Number(p.time) === Number(time));
    },
    [chart.overlays.patterns, focusedPatternTime],
  );
  const chartReading = useMemo((): ChartReading | null => {
    if (showingForming) {
      const match = provisional?.shape && (patternName === "all" || patternName === provisional.shape);
      return {
        kicker: "Forming preview · closed 1h observations only",
        setup: provisional ? (match ? `${provisional.shape} · provisional` : "No selected engulfing shape yet") : "No partial 4h candle available",
        steps: [{ n: "01", label: "As observed", value: provisional
          ? `${provisional.parts} of 4 hourly bars · through ${stamp(provisional.through)} UTC`
          : "At a complete boundary, or with missing hours, no provisional candle is drawn. Step forward or choose another replay position." }],
        because: "The amber candle can change or disappear as more hourly bars arrive. No intrahour ticks are inferred. Confirmed indicators and exports still use closed 4h candles only.",
        provisional: true,
        anchor: provisional ? { time: provisional.bar.t, label: "Forming" } : undefined,
      };
    }
    if (analysis === "context") {
      return {
        kicker: "Murphy reading · last closed bar",
        setup: murphy.setup,
        steps: [
          { n: "01", label: "Direction", value: murphy.trend },
          { n: "02", label: "Location", value: murphy.location },
          {
            n: "03",
            label: "Momentum",
            value:
              murphy.rsi === undefined ? "RSI —" : `RSI ${murphy.rsi.toFixed(1)}`,
          },
        ],
        because: murphy.because,
        anchor: last ? { time: last.t, label: murphy.setup } : undefined,
      };
    }
    if (analysis === "patterns") {
      return {
        kicker: highlightTime === focusedPatternTime && highlightTime !== null ? "Selected closed shape" : "Latest matching closed shape",
        setup: displayedPatterns.length
          ? displayedPatterns.map((p) => p.name).join(" · ")
          : "No matching shape in this slice",
        steps: [
          {
            n: "01",
            label: "Geometry",
            value: displayedPatterns[0] ? `${stamp(Number(displayedPatterns[0].time))} UTC · ${displayedPatterns[0].variant}` : "Try another shape, market or replay position.",
          },
        ],
        because:
          "Shapes describe this closed candle only. They are not a next-bar forecast.",
      };
    }
    if (analysis === "ema" || analysis === "bands" || analysis === "swings" || analysis === "case") {
      const setup = analysis === "ema" ? murphy.trend : analysis === "bands" ? murphy.location : "Confirmed swing structure";
      return {
        kicker: analysis === "case" ? "Saved BTC case · current replay position" : "Selected overlay · closed candles",
        setup,
        steps: [{ n: "01", label: "On the chart", value: analysis === "ema" ? `EMA ${fastPeriod} and EMA ${slowPeriod}` : analysis === "bands" ? "Bollinger upper, middle and lower bands" : "Lines join confirmed swing highs and lows" }],
        because: analysis === "ema" || analysis === "bands" ? murphy.because : "Swing points are drawn only after their confirmation candles are available. These lines describe structure, not an entry or target.",
        anchor: last && (analysis === "ema" || analysis === "bands") ? { time: last.t, label: setup } : undefined,
      };
    }
    return null;
  }, [analysis, displayedPatterns, murphy, last, fastPeriod, slowPeriod, highlightTime, focusedPatternTime, showingForming, provisional, patternName]);
  const periodChange = last && first ? (last.c / first.o - 1) * 100 : undefined;
  const filtered = availableSources.filter((s) =>
    `${s.symbol} ${s.label} ${s.group}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  useEffect(() => {
    if (!active || busy || replayCount !== null) return;
    if ((frames[timeframe]?.length ?? 0) > 0) return;
    const next = intervals.find((tf) => (frames[tf]?.length ?? 0) > 0);
    if (next) setTimeframe(next);
  }, [active, busy, frames, timeframe, intervals, replayCount]);

  const selectMarket = (id: string) => {
    workspaceRef.current?.querySelectorAll("details[open]").forEach(el => el.removeAttribute("open"));
    const next = SOURCES.find((s) => s.id === id)!;
    setSourceId(id);
    setTimeframe(SOURCE_INTERVALS(next)[0]);
    setReplayCount(null);
    setTool("inspect");
    setHighlightTime(null);
    if (analysis === "case" && next.kind !== "case") setAnalysis("none");
  };
  const changeTimeframe = (value: Interval) => {
    setTimeframe(value);
    setHighlightTime(null);
    if (source.kind === "public") setReplayCount(null);
  };
  const toggle = (layer: keyof ProfessionalLayerState) =>
    setLayers((value) => ({ ...value, [layer]: !value[layer] }));
  const chooseAnalysis = (next: Analysis) => {
    workspaceRef.current?.querySelectorAll("details[open]").forEach(el => el.removeAttribute("open"));
    setAnalysis(next);
    setHighlightTime(null);
    setTool("inspect");
    // SOURCE: explicit indicator presets add their layer; reading modes preserve user choices.
    if (next === "ema") setLayers(value => ({ ...value, ema: true }));
    if (next === "bands") setLayers(value => ({ ...value, bollinger: true }));
    if (next === "swings" || next === "case") setLayers(value => ({ ...value, trendlines: true }));
    // SOURCE: explicit setup selection should reveal the plot below the introduction.
    requestAnimationFrame(() => workspaceRef.current?.querySelector("#workspace")?.scrollIntoView({ block: "start" }));
  };
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
          <p><strong>A chart that only knows what happened so far.</strong> Inspect prices, spot candle shapes and rewind a recording. The chart recalculates using only the candles available at that moment — never later prices.</p>
          <p><strong>{publicMarkets.length} public crypto markets · {recordings.length} market recordings · {savedCases.length} saved BTC case.</strong> Public markets load recent closed candles. Recordings are dated examples, not live prices; these are data options, not all different assets.</p>
        </div>
        <ol className="mw-quickstart" aria-label="Start here">
          <li><strong>Choose a market and a timeframe below.</strong> Start with Gold in Recorded commodities for a saved example, or BTC, ETH or SOL for a public snapshot.</li>
          <li><strong>Choose what to inspect.</strong> Candlestick patterns → Bullish engulfing highlights a rising candle whose body covers the previous falling body. Markers are drawn automatically on the chart; no match is labelled clearly. Murphy → Trend &amp; location gives a short reading beside the chart. Indicators are optional.</li>
          <li><strong>Rewind and step forward.</strong> On a recording, move the Replay slider back, then step through the candles to see the reading change. Export saves the closed candles you can see, with their source.</li>
        </ol>
        <details className="mw-recording-list"><summary>Available recordings and the forming-candle preview</summary>
          <p>{recordings.map((s) => s.label).join(" · ")}. These are recorded perpetual contracts; the separate BTC case comes from Hyperliquid.</p>
          <p>On an hourly recording, select 4h and an engulfing pattern, then enable Preview forming 4h. The amber body builds from closed hourly candles. Its pattern can disappear before the four-hour candle closes; this is not tick-by-tick playback.</p>
        </details>
        <a className="mw-start" href="#workspace">Explore the chart ↓</a>
      </section>
      <ProjectGuide />
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
            {[...new Set(availableSources.map((s) => s.group))].map((group) => (
              <optgroup label={group} key={group}>
                {availableSources.filter((s) => s.group === group).map((s) => (
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
            <p>Geometric shapes drawn on the candle that formed them. Open Analysis to read the names.</p>
          </div>
        </details>
        <label className="mw-analysis-select">
          Setup / pattern
          <select
            aria-label="Analysis panel"
            value={analysis}
            onChange={(e) => chooseAnalysis(e.target.value as Analysis)}
          >
            <option value="none">Choose a setup…</option>
            <option value="context">Trend & location · Murphy</option>
            <option value="ema">EMA trend</option>
            <option value="bands">Bollinger location</option>
            <option value="swings">Confirmed swings</option>
            <option value="patterns">Candlestick patterns</option>
            <option value="timeframes">Compare timeframes</option>
            {source.kind === "case" && (
              <option value="case">Saved case explained</option>
            )}
          </select>
        </label>
        {analysis === "patterns" && (
          <label className="mw-analysis-select">Pattern
            <select aria-label="Candlestick pattern" value={patternName} onChange={e => {
              setPatternName(e.target.value);
              setHighlightTime(null);
            }}>
              <option value="all">All candle shapes</option>
              {PATTERN_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        )}
        <button onClick={() => setRevision((n) => n + 1)} disabled={busy}>
          ↻ Refresh
        </button>
        <details className="mw-menu mw-help">
          <summary aria-label="Help and source details">?</summary>
          <div className="mw-popover">
            <h2>How to use this workspace</h2>
            <p>
              Choose a market, then a setup or pattern. Pattern markers draw automatically;
              Indicators controls the optional overlays. Manual annotations are under Inspect tools.
              Public quotes update automatically; Refresh reloads the chart’s closed candles.
              Historical markets can be rewound with Replay.
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
                ? "Closed candles load through the market API. The separate mid-price uses a read-only WebSocket; it is not an executed trade price. Its timestamp is local receipt time, not exchange latency."
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
            <p><a href="https://github.com/coder058/pattern-forge" target="_blank" rel="noreferrer">Code and setup on GitHub ↗</a></p>
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
              <small>Last closed {timeframe} candle</small>
              {periodChange !== undefined && !busy && (
                <span className={periodChange >= 0 ? "positive" : "negative"}>
                  {periodChange >= 0 ? "+" : ""}
                  {periodChange.toFixed(2)}% <small>loaded range</small>
                </span>
              )}
            </div>
          </div>
          {source.kind === "public" && <LiveQuote key={source.symbol} symbol={source.symbol} />}
          {active?.failures && Object.keys(active.failures).length > 0 && (
            <p className="mw-partial-warning" role="status">
              Unavailable intervals: {Object.keys(active.failures).join(", ")}. Showing available data only. Try Refresh to retry.
            </p>
          )}
          <div className="mw-chart-tools">
            {canPreview && <label><input type="checkbox" checked={previewForming} onChange={e => setPreviewForming(e.target.checked)} /> Preview forming 4h</label>}
            <details className="mw-menu">
              <summary>Inspect tools</summary>
              <div className="mw-popover">
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
              </div>
            </details>
            {tool !== "inspect" && <button onClick={() => setTool("inspect")}>Exit drawing mode</button>}
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
              {visibleLayers.patterns && <span>Patterns</span>}
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
                <button onClick={() => selectMarket("saved-btc")}>Open saved BTC recording</button>
              </div>
            ) : !bars.length ? (
              <div className="mw-empty">
                <h2>No complete {timeframe} candles here</h2>
                <p>
                  Move the replay forward or select a smaller interval. Missing
                  bars are never invented.
                </p>
                <button onClick={() => selectMarket("public-BTC")}>
                  Open BTC 5m
                </button>
              </div>
            ) : (
              <ProfessionalChart
                key={sourceId}
                data={chart}
                timeframe={timeframe}
                layers={visibleLayers}
                tool={tool}
                clearToken={clearToken}
                symbol={source.symbol}
                lowerPanel={lowerPanel}
                oscillatorData={oscillatorData}
                reading={chartReading}
                highlightTime={focusedPatternTime}
                provisionalCandle={provisional?.bar}
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
                    ? "Murphy setup"
                    : analysis === "patterns"
                      ? showingForming ? "Earlier closed matches" : "Candle patterns"
                      : analysis === "ema" ? "EMA trend" : analysis === "bands" ? "Bollinger location" : analysis === "swings" ? "Confirmed swings" : "Saved BTC case"}
              </h2>
              <button
                aria-label="Close analysis"
                onClick={() => chooseAnalysis("none")}
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
                  first, then price location and momentum. The same setup is
                  drawn on the last closed bar. No combined score.
                </p>
                <article>
                  <h3>Setup on the chart</h3>
                  <strong>{murphy.setup}</strong>
                  <p>{murphy.because}</p>
                </article>
                <article>
                  <h3>01 / Direction</h3>
                  <strong>{murphy.trend}</strong>
                  <p>
                    Rising: close above EMA {fastPeriod} above EMA {slowPeriod}. Falling: the
                    reverse. Mixed: the averages and price disagree.
                  </p>
                </article>
                <article>
                  <h3>02 / Location</h3>
                  <strong>{murphy.location}</strong>
                  <p>
                    Position within the recent closing-price distribution.
                    Outside a band does not by itself imply a reversal.
                  </p>
                </article>
                <article>
                  <h3>03 / Momentum</h3>
                  <strong>
                    {murphy.rsi === undefined
                      ? "RSI —"
                      : `RSI ${murphy.rsi.toFixed(1)}`}
                  </strong>
                  <p>
                    Wilder RSI (14) compares recent gains with losses on a 0–100
                    scale. A high value is not an automatic sell.
                  </p>
                </article>
                <p className="mw-note">
                  Descriptive context, not a complete implementation of Murphy’s
                  framework or a calibrated strategy. Indicators stay under your control.
                </p>
                <button onClick={() => setLayers(value => ({ ...value, ema: true, bollinger: true }))}>Show supporting indicators</button>
              </>
            ) : analysis === "ema" || analysis === "bands" || analysis === "swings" ? (
              <>
                <p>{chartReading?.because}</p>
                <article><h3>On this chart</h3><strong>{chartReading?.setup}</strong>
                  <p>{chartReading?.steps[0]?.value}. Change the market or replay position to recalculate from the available candles.</p>
                </article>
                <p>These are descriptive indicators, not tested entry or exit strategies.</p>
              </>
            ) : analysis === "patterns" ? (
              <>
                {showingForming ? <p>The amber candle is provisional. These results are older, closed shapes. Select one to leave the preview and inspect that match.</p> :
                <p>
                  Shapes formed by closed candles, marked on those candles.
                  Choose a shape above to focus the latest match. Select an earlier result below to inspect it.
                  They describe the body and wicks, not what price will do next.
                </p>}
                <p>The match can be older than the last candle; check its timestamp. Both bodies matter for an engulfing shape.</p>
                {chart.overlays.patterns
                  .slice()
                  .reverse()
                  .slice(0, RECENT_PATTERN_LIMIT)
                  .map((pattern, i) => (
                    <button
                      type="button"
                      className={
                        highlightTime === Number(pattern.time)
                          ? "mw-pattern-hit is-active"
                          : "mw-pattern-hit"
                      }
                      key={`${pattern.time}-${i}`}
                      onClick={() => {
                        setPreviewForming(false);
                        setHighlightTime(Number(pattern.time));
                        requestAnimationFrame(() => workspaceRef.current?.querySelector(".professional-chart")?.scrollIntoView({ block: "start" }));
                      }}
                    >
                      <h3>{pattern.name}</h3>
                      <time>{stamp(Number(pattern.time))}</time>
                      <p>{pattern.variant}</p>
                    </button>
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
