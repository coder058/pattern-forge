"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type MarketSource,
} from "./marketSources";
import "./workspace.css";
import { LiveQuote } from "./QuoteTicker";

type Tab = "patterns" | "trend" | "timeframes" | "case";
type LowerPane = "none" | "volume" | "rsi" | "macd";
// SOURCE: detector names implemented in marketAnalysis.calculateChart.
const PATTERN_NAMES = ["Bullish engulfing", "Bearish engulfing", "Hammer shape", "Shooting-star shape", "Doji"];
// SOURCE: plain-language glossary for the detector rules in docs/reading-rules.md.
const PATTERN_HELP: Record<string, string> = {
  "Bullish engulfing": "A rising candle whose body covers the previous falling body.",
  "Bearish engulfing": "A falling candle whose body covers the previous rising body.",
  "Hammer shape": "A small body with a long lower wick: sellers pushed down, price came back.",
  "Shooting-star shape": "A small body with a long upper wick: buyers pushed up, price came back.",
  Doji: "Open and close almost equal: neither side won the candle.",
};
// SOURCE: editorial default — the first screen shows marked patterns on a recording
// that always loads, instead of an empty chart or a live feed that may be down.
const DEFAULT_SOURCE = "recorded-XAUUSD";
const DEFAULT_TIMEFRAME: Interval = "4h";
// SOURCE: editorial defaults: candles plus pattern markers, other layers optional.
const DEFAULT_LAYERS: ProfessionalLayerState = {
  ema: false,
  bollinger: false,
  trendlines: false,
  patterns: true,
  touches: false,
  plans: false,
};
// GUESS: UNCALIBRATED GUESS — bounded network wait, not a market assumption.
const REQUEST_TIMEOUT_MS = 20000;
// GUESS: UNCALIBRATED GUESS — list length for readability only, never detector output.
const PATTERN_LIST_LIMIT = 12;
// GUESS: UNCALIBRATED GUESS — replay starts far enough back to show several patterns form.
const REPLAY_START_BACK = 150;
// GUESS: UNCALIBRATED GUESS — playback pacing for reading, not market time.
const REPLAY_SPEEDS = [{ label: "1×", ms: 900 }, { label: "2×", ms: 450 }, { label: "4×", ms: 200 }];
const GUIDE_KEY = "pf-guide-v2-seen";

const price = (n?: number) =>
  n === undefined ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
const stamp = (t: number) =>
  new Date(t).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  });
const kindLabel = (s: MarketSource) =>
  s.kind === "public" ? "Live" : s.kind === "case" ? "Case" : s.kind === "stored" ? "Stored" : "Replay";
const tone = (direction: string) =>
  /bull|long/i.test(direction) ? "bull" : /bear|short/i.test(direction) ? "bear" : "neutral";

export default function MarketWorkspace({ storedEnabled = false }: { storedEnabled?: boolean }) {
  const [sourceId, setSourceId] = useState(DEFAULT_SOURCE);
  const [timeframe, setTimeframe] = useState<Interval>(DEFAULT_TIMEFRAME);
  const [loaded, setLoaded] = useState<LoadedMarket | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("patterns");
  const [panelOpen, setPanelOpen] = useState(true);
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [tool, setTool] = useState<ProfessionalDrawTool>("inspect");
  const [clearToken, setClearToken] = useState(0);
  const [replayCount, setReplayCount] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [fastPeriod, setFastPeriod] = useState(DEFAULT_INDICATORS.fast);
  const [slowPeriod, setSlowPeriod] = useState(DEFAULT_INDICATORS.slow);
  const [highlightTime, setHighlightTime] = useState<number | null>(null);
  const [patternName, setPatternName] = useState("all");
  const [previewForming, setPreviewForming] = useState(false);
  const [lowerPanel, setLowerPanel] = useState<LowerPane>("volume");
  const [guideOpen, setGuideOpen] = useState(false);
  const [showAllHits, setShowAllHits] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const source = SOURCES.find((s) => s.id === sourceId)!;
  const availableSources = SOURCES.filter((s) => storedEnabled || s.kind !== "stored");
  const intervals = useMemo(() => SOURCE_INTERVALS(source), [source]);
  const replayable = source.kind !== "public";

  const closeMenus = () =>
    workspaceRef.current?.querySelectorAll("details[open]").forEach((el) => el.removeAttribute("open"));

  useEffect(() => {
    try { if (!localStorage.getItem(GUIDE_KEY)) setGuideOpen(true); } catch { /* storage blocked: skip the tour */ }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setBusy(true);
    setError("");
    setLoaded(null);
    setReplayCount(null);
    setPlaying(false);
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    loadMarket(source, controller.signal)
      .then((value) => {
        if (!current) return;
        setLoaded(value);
        // SOURCE: use an actually loaded interval; never label another frame as the failed one.
        setTimeframe((selected) => {
          const allowed = SOURCE_INTERVALS(source);
          const has = (tf: Interval) =>
            (value.frames[tf]?.length ?? 0) > 0 || (value.base !== undefined && allowed.includes(tf) && (value.frames[value.base]?.length ?? 0) > 0);
          if (allowed.includes(selected) && has(selected)) return selected;
          return allowed.find(has) ?? allowed[0] ?? selected;
        });
      })
      .catch((cause) => {
        if (current)
          setError(cause.name === "AbortError"
            ? "The source took too long to respond."
            : cause.message);
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
    const outside = (event: PointerEvent) => {
      workspaceRef.current?.querySelectorAll("details[open]").forEach((el) => {
        if (!el.contains(event.target as Node)) el.removeAttribute("open");
      });
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  const active = loaded?.id === sourceId ? loaded : null;
  const replayBase = active?.base ?? (source.kind === "case" ? "5m" : timeframe);
  const baseBars = active?.frames[replayBase] ?? [];
  const count = replayCount === null ? baseBars.length : Math.min(replayCount, baseBars.length);
  const inReplay = replayable && replayCount !== null && count < baseBars.length;
  const cutoff = baseBars[count - 1]?.closeTime ?? active?.asOf ?? 0;
  const frames = useMemo(
    () =>
      Object.fromEntries(
        intervals.map((interval) => {
          const native = (active?.frames[interval] ?? []).filter((b) => b.closeTime <= cutoff);
          if (!active?.base || interval === active.base) return [interval, native];
          return [interval, aggregateBars(active.frames[active.base] ?? [], active.base, interval, cutoff)];
        }),
      ) as Partial<Record<Interval, Bar[]>>,
    [active, cutoff, intervals],
  );
  const bars = frames[timeframe] ?? [];
  const canPreview = source.kind === "recording" && replayBase === "1h" && timeframe === "4h" &&
    tab === "patterns" && (patternName === "all" || patternName.endsWith("engulfing"));
  const showingForming = canPreview && previewForming;
  const provisional = useMemo(() => (showingForming ? formingFourHour(baseBars, cutoff) : null),
    [showingForming, baseBars, cutoff]);
  const chart = useMemo(() => {
    const result = calculateChart(bars, fastPeriod, slowPeriod);
    if (patternName !== "all") result.overlays.patterns = result.overlays.patterns.filter((p) => p.name === patternName);
    return result;
  }, [bars, fastPeriod, slowPeriod, patternName]);
  const oscillatorData = useMemo(
    () => (lowerPanel === "rsi" ? { line: rsi(bars) } : lowerPanel === "macd" ? macd(bars) : undefined),
    [bars, lowerPanel],
  );
  const murphy = useMemo(() => murphyReading(bars, fastPeriod, slowPeriod), [bars, fastPeriod, slowPeriod]);
  const last = bars.at(-1);
  const prev = bars.at(-2);
  const patterns = chart.overlays.patterns;
  const latestPatternTime = patterns.at(-1)?.time;
  // SOURCE: a selection must belong to this replay prefix; otherwise use its latest match.
  const focusedPatternTime = tab === "patterns" && !showingForming
    ? (patterns.some((p) => Number(p.time) === highlightTime)
      ? highlightTime : latestPatternTime === undefined ? null : Number(latestPatternTime))
    : null;
  const visibleLayers = useMemo(() => ({ ...layers, patterns: showingForming ? false : layers.patterns }),
    [layers, showingForming]);
  const focused = useMemo(
    () => patterns.filter((p) => Number(p.time) === Number(focusedPatternTime)),
    [patterns, focusedPatternTime],
  );
  const chartReading = useMemo((): ChartReading | null => {
    if (showingForming) {
      const match = provisional?.shape && (patternName === "all" || patternName === provisional.shape);
      return {
        kicker: "Forming preview · closed 1h observations only",
        setup: provisional ? (match ? `${provisional.shape} · provisional` : "No selected engulfing shape yet") : "No partial 4h candle available",
        sentence: provisional
          ? `Forming 4h candle from ${provisional.parts} of 4 closed hourly bars. It can still change or disappear.`
          : "At a complete 4h boundary, or with missing hours, no provisional candle is drawn.",
        steps: [],
        because: "No intrahour ticks are inferred. Confirmed indicators and exports still use closed 4h candles only.",
        provisional: true,
        anchor: provisional ? { time: provisional.bar.t, label: "Forming" } : undefined,
      };
    }
    if (tab === "trend") {
      return {
        kicker: "Murphy reading · last closed bar",
        setup: murphy.setup,
        sentence: `${murphy.setup}: ${murphy.because.split(/(?<=\.)\s/).at(0)}`,
        steps: [],
        because: murphy.because,
        anchor: last ? { time: last.t, label: murphy.setup } : undefined,
      };
    }
    if (tab === "patterns" && layers.patterns) {
      return {
        kicker: "Candlestick pattern",
        setup: focused.map((p) => p.name).join(" · ") || "No matching pattern",
        sentence: focused[0]
          ? `${focused.map((p) => p.name).join(" + ")} · ${stamp(Number(focused[0].time))} UTC — ${PATTERN_HELP[focused[0].name] ?? focused[0].variant}`
          : "No matching pattern in the visible history. Try another pattern, timeframe or market.",
        steps: [],
        because: "Shapes describe closed candles only. They are not a forecast.",
      };
    }
    return null;
  }, [tab, focused, murphy, last, showingForming, provisional, patternName, layers.patterns]);
  const change = last && prev ? (last.c / prev.c - 1) * 100 : undefined;
  const filtered = availableSources.filter((s) =>
    `${s.symbol} ${s.label} ${s.group}`.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (!active || busy || replayCount !== null) return;
    if ((frames[timeframe]?.length ?? 0) > 0) return;
    const next = intervals.find((tf) => (frames[tf]?.length ?? 0) > 0);
    if (next) setTimeframe(next);
  }, [active, busy, frames, timeframe, intervals, replayCount]);

  // Bar replay: advance one base candle per tick until the end of the recording.
  useEffect(() => {
    if (!playing) return;
    if (count >= baseBars.length) { setPlaying(false); return; }
    const timer = setTimeout(() => setReplayCount(count + 1), REPLAY_SPEEDS[speed].ms);
    return () => clearTimeout(timer);
  }, [playing, count, baseBars.length, speed]);

  const selectMarket = (id: string) => {
    closeMenus();
    const next = SOURCES.find((s) => s.id === id)!;
    setSourceId(id);
    // SOURCE: keep the reader's timeframe when the new market offers it.
    // The saved case happens within minutes, so it opens on its 5m story.
    setTimeframe((tf) => (next.kind === "case" ? "5m" : SOURCE_INTERVALS(next).includes(tf) ? tf : SOURCE_INTERVALS(next)[0]));
    setReplayCount(null);
    setPlaying(false);
    setTool("inspect");
    setHighlightTime(null);
    setQuery("");
    if (next.kind === "case") setLayers((v) => ({ ...v, trendlines: true }));
    setTab((t) => (t === "case" && next.kind !== "case" ? "patterns" : next.kind === "case" ? "case" : t));
  };
  const changeTimeframe = (value: Interval) => {
    setTimeframe(value);
    setHighlightTime(null);
  };
  const toggle = (layer: keyof ProfessionalLayerState) => setLayers((v) => ({ ...v, [layer]: !v[layer] }));
  const choosePattern = (name: string) => {
    setPatternName(name);
    setHighlightTime(null);
    setLayers((v) => ({ ...v, patterns: true }));
  };
  const openTab = (next: Tab) => {
    setTab(next);
    setPanelOpen(true);
    setHighlightTime(null);
    // SOURCE: the trend reading is built from EMA and band position; show what it refers to.
    if (next === "trend") setLayers((v) => ({ ...v, ema: true, bollinger: true }));
  };
  const startReplay = useCallback(() => {
    if (!baseBars.length) return;
    setReplayCount(Math.max(2, baseBars.length - REPLAY_START_BACK));
    setPlaying(true);
    setHighlightTime(null);
  }, [baseBars.length]);
  const step = useCallback((delta: number) => {
    setPlaying(false);
    setHighlightTime(null);
    setReplayCount((value) => {
      const now = value ?? baseBars.length;
      return Math.max(1, Math.min(baseBars.length, now + delta));
    });
  }, [baseBars.length]);
  const togglePlay = useCallback(() => {
    if (playing) { setPlaying(false); return; }
    if (count >= baseBars.length) startReplay();
    else setPlaying(true);
  }, [playing, count, baseBars.length, startReplay]);
  const exitReplay = () => { setPlaying(false); setReplayCount(null); };
  const closeGuide = () => {
    setGuideOpen(false);
    try { localStorage.setItem(GUIDE_KEY, "1"); } catch { /* storage blocked */ }
  };

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { closeMenus(); setGuideOpen(false); return; }
      const target = event.target as HTMLElement;
      if (target.closest("input, select, textarea, [contenteditable]")) return;
      if (event.key === "/") {
        event.preventDefault();
        const menu = workspaceRef.current?.querySelector<HTMLDetailsElement>(".pf-symbol");
        if (menu) { menu.open = true; requestAnimationFrame(() => searchRef.current?.focus()); }
      }
      if (!replayable || !baseBars.length) return;
      if (event.key === "ArrowRight" && event.shiftKey) { event.preventDefault(); step(1); }
      if (event.key === "ArrowLeft" && event.shiftKey) { event.preventDefault(); step(-1); }
      if (event.key === " " && !target.closest("button, summary")) { event.preventDefault(); togglePlay(); }
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [replayable, baseBars.length, step, togglePlay]);

  const exportData = () => {
    const document = {
      source: { symbol: source.symbol, venue: source.venue, kind: source.kind, note: source.note, sourceSha256: source.sourceSha256 },
      asOf: active?.asOf,
      replayCutoff: cutoff,
      interval: timeframe,
      candles: bars,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${source.symbol}-${timeframe}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const groups = [...new Set(filtered.map((s) => s.group))];
  const counts = useMemo(() => {
    const all = calculateChart(bars, fastPeriod, slowPeriod).overlays.patterns;
    return Object.fromEntries(PATTERN_NAMES.map((n) => [n, all.filter((p) => p.name === n).length])) as Record<string, number>;
  }, [bars, fastPeriod, slowPeriod]);

  return (
    <main className="market-workspace pf-app" ref={workspaceRef}>
      <h1 className="sr-only">Pattern Forge — candlestick patterns, trend reading and bar replay</h1>
      <header className="pf-top">
        <a className="pf-brand" href="/" aria-label="Pattern Forge home">
          <span className="pf-logo" aria-hidden="true">◆</span>
          <span>Pattern Forge</span>
        </a>
        <details className="pf-symbol" onToggle={(e) => { if (e.currentTarget.open) requestAnimationFrame(() => searchRef.current?.focus()); }}>
          <summary aria-label="Change market">
            <strong>{source.kind === "public" ? source.symbol : source.label}</strong>
            <span className={`pf-kind pf-kind-${source.kind}`}>{kindLabel(source)}</span>
            <span aria-hidden="true">⌄</span>
          </summary>
          <div className="pf-popover pf-markets" role="dialog" aria-label="Markets">
            <input
              ref={searchRef}
              type="search"
              aria-label="Search markets"
              placeholder="Search: gold, BTC, oil…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && filtered[0]) selectMarket(filtered[0].id); }}
            />
            {groups.map((group) => (
              <section key={group}>
                <h3>{group}</h3>
                {filtered.filter((s) => s.group === group).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => selectMarket(s.id)}
                    aria-pressed={s.id === sourceId}
                    className={s.id === sourceId ? "selected" : ""}
                  >
                    <span>
                      <strong>{s.kind === "public" ? `${s.symbol} · ${s.label}` : s.label}</strong>
                      <small>{s.kind === "case" ? "28 Jul 2026 · failed breakout" : s.kind === "public" ? "Hyperliquid · latest closed candles" : `${s.venue} · recorded hourly`}</small>
                    </span>
                    <em className={`pf-kind pf-kind-${s.kind}`}>{kindLabel(s)}</em>
                  </button>
                ))}
              </section>
            ))}
            {!filtered.length && <p className="pf-muted">No matching market.</p>}
          </div>
        </details>
        <div className="pf-tf" role="group" aria-label="Chart timeframe">
          {intervals.map((tf) => (
            <button
              key={tf}
              onClick={() => changeTimeframe(tf)}
              disabled={!!active?.failures?.[tf]}
              title={active?.failures?.[tf] ? `${tf} unavailable` : `${tf} candles`}
              aria-pressed={tf === timeframe}
            >
              {tf}
            </button>
          ))}
        </div>
        <span className="pf-sep" aria-hidden="true" />
        <details className="pf-menu">
          <summary>Indicators</summary>
          <div className="pf-popover">
            <h2>On the price chart</h2>
            <label><input type="checkbox" checked={layers.patterns} onChange={() => toggle("patterns")} /> Candlestick pattern markers</label>
            <label><input type="checkbox" checked={layers.ema} onChange={() => toggle("ema")} /> Moving averages (EMA)</label>
            <div className="pf-periods">
              <label>Fast
                <select aria-label="Fast EMA period" value={fastPeriod} onChange={(e) => setFastPeriod(Number(e.target.value))}>
                  {[9, 20, 50].map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
              <label>Slow
                <select aria-label="Slow EMA period" value={slowPeriod} onChange={(e) => setSlowPeriod(Number(e.target.value))}>
                  {[26, 50, 100, 200].map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <label><input type="checkbox" checked={layers.bollinger} onChange={() => toggle("bollinger")} /> Bollinger Bands (20, 2)</label>
            <label><input type="checkbox" checked={layers.trendlines} onChange={() => toggle("trendlines")} /> Swing structure</label>
            <h2>Lower pane</h2>
            <div className="pf-radio" role="radiogroup" aria-label="Lower indicator pane">
              {(["volume", "rsi", "macd", "none"] as LowerPane[]).map((pane) => (
                <label key={pane}>
                  <input type="radio" name="lower-pane" checked={lowerPanel === pane} onChange={() => setLowerPanel(pane)} />
                  {pane === "volume" ? "Volume" : pane === "rsi" ? "RSI 14" : pane === "macd" ? "MACD" : "Off"}
                </label>
              ))}
            </div>
          </div>
        </details>
        {replayable && (
          <button
            className={`pf-replay-btn ${replayCount !== null ? "is-on" : ""}`}
            onClick={() => (replayCount !== null ? exitReplay() : startReplay())}
            disabled={!baseBars.length}
            aria-pressed={replayCount !== null}
            title="Rewind and watch the candles form one by one (Space)"
          >
            {replayCount !== null ? "■ Exit replay" : "⏵ Replay"}
          </button>
        )}
        <div className="pf-top-right">
          <button className="pf-ghost" onClick={() => setGuideOpen(true)} aria-label="Show the quick guide">?</button>
          <a className="pf-ghost" href="/about">How it works</a>
          <a className="pf-ghost pf-hide-sm" href="https://github.com/coder058/pattern-forge" target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
      </header>

      <div className={`pf-body ${panelOpen ? "with-panel" : ""}`}>
        <nav className="pf-rail" aria-label="Drawing tools">
          {([
            ["inspect", "✛", "Crosshair"],
            ["trend", "╱", "Trendline"],
            ["horizontal", "—", "Horizontal level"],
            ["measure", "↕", "Measure"],
          ] as [ProfessionalDrawTool, string, string][]).map(([value, icon, label]) => (
            <button
              key={value}
              aria-label={label}
              title={label}
              aria-pressed={tool === value}
              onClick={() => setTool(value)}
            >
              {icon}
            </button>
          ))}
          <button aria-label="Clear drawings" title="Clear drawings" onClick={() => { setClearToken((n) => n + 1); setTool("inspect"); }}>⌫</button>
        </nav>

        <section className="pf-chart" id="price-chart" aria-label="Market chart">
          <div className="pf-legend">
            <div className="pf-title">
              <h2>{source.label} <span>{source.symbol} · {timeframe} · {source.venue}</span></h2>
              {!busy && !error && last && (
                <p className="pf-ohlc">
                  <strong>{price(last.c)}</strong>
                  {change !== undefined && (
                    <span className={change >= 0 ? "up" : "down"}>
                      {change >= 0 ? "+" : ""}{change.toFixed(2)}%
                    </span>
                  )}
                  <small>{inReplay ? "Replay — later candles hidden" : source.kind === "public" ? "Last closed candle" : `Recording · ends ${stamp(active?.asOf ?? 0)} UTC`}</small>
                </p>
              )}
            </div>
            {source.kind === "public" && <LiveQuote key={source.symbol} symbol={source.symbol} />}
            <div className="pf-chips" aria-label="Active layers">
              {layers.patterns && <button onClick={() => toggle("patterns")} title="Hide pattern markers">Patterns ✕</button>}
              {layers.ema && <button className="ema" onClick={() => toggle("ema")} title="Hide EMA">EMA {fastPeriod}/{slowPeriod} ✕</button>}
              {layers.bollinger && <button className="bands" onClick={() => toggle("bollinger")} title="Hide bands">BB 20/2 ✕</button>}
              {layers.trendlines && <button onClick={() => toggle("trendlines")} title="Hide swings">Swings ✕</button>}
            </div>
          </div>
          {active?.failures && Object.keys(active.failures).length > 0 && (
            <p className="pf-warning" role="status">
              Unavailable intervals: {Object.keys(active.failures).join(", ")}. Showing available data only.
            </p>
          )}
          <div className="pf-canvas">
            {busy ? (
              <div className="pf-empty" role="status"><span className="pf-spinner" aria-hidden="true" />Loading {source.label}…</div>
            ) : error ? (
              <div className="pf-empty" role="alert">
                <h2>{source.label} is not loading right now</h2>
                <p>{error} Recordings always work, even offline.</p>
                <div>
                  <button className="pf-primary" onClick={() => selectMarket(DEFAULT_SOURCE)}>Open the Gold recording</button>
                  <button onClick={() => setRevision((n) => n + 1)}>Try again</button>
                </div>
              </div>
            ) : !bars.length ? (
              <div className="pf-empty">
                <h2>No complete {timeframe} candles yet</h2>
                <p>Step the replay forward or choose a smaller timeframe. Missing candles are never invented.</p>
                <button className="pf-primary" onClick={() => changeTimeframe(intervals[0])}>Show {intervals[0]}</button>
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
                // SOURCE: zoom only when the reader picks a match; the first view stays wide.
                highlightTime={tab === "patterns" ? highlightTime : null}
                provisionalCandle={provisional?.bar}
              />
            )}
            {guideOpen && (
              <aside className="pf-guide-card" aria-label="Quick guide">
                <h2>Read a chart without hindsight</h2>
                <ol>
                  <li><strong>Patterns are marked for you.</strong> Arrows on the chart; the pattern list jumps to each one.</li>
                  <li><strong>Press ⏵ Replay.</strong> The chart rewinds and candles appear one by one — patterns appear only once their candle has closed.</li>
                  <li><strong>Read the trend.</strong> The Trend tab gives a short Murphy-style reading of the last candle.</li>
                </ol>
                <p className="pf-muted">Shortcuts: <kbd>Space</kbd> play/pause · <kbd>Shift</kbd>+<kbd>←</kbd><kbd>→</kbd> step · <kbd>/</kbd> search markets</p>
                <button className="pf-primary" onClick={closeGuide}>Got it</button>
              </aside>
            )}
          </div>
          {replayable && baseBars.length > 0 && replayCount !== null && (
            <div className="pf-replay" role="group" aria-label="Bar replay">
              <button aria-label="Previous replay candle" onClick={() => step(-1)} disabled={count <= 1}>⏮</button>
              <button className="pf-play" aria-label={playing ? "Pause replay" : "Play replay"} onClick={togglePlay}>
                {playing ? "❚❚" : "⏵"}
              </button>
              <button aria-label="Next replay candle" onClick={() => step(1)} disabled={count >= baseBars.length}>⏭</button>
              <div className="pf-speed" role="group" aria-label="Replay speed">
                {REPLAY_SPEEDS.map((s, i) => (
                  <button key={s.label} aria-pressed={speed === i} onClick={() => setSpeed(i)}>{s.label}</button>
                ))}
              </div>
              <input
                aria-label="Replay position"
                type="range"
                min={1}
                max={baseBars.length}
                value={count}
                onChange={(e) => { setPlaying(false); setReplayCount(Number(e.target.value)); }}
              />
              <time>{stamp(cutoff)} UTC</time>
              <button onClick={exitReplay}>Jump to end</button>
            </div>
          )}
          <footer className="pf-status">
            <span>
              {busy ? "Fetching…" : error ? "Source unavailable"
                : `${bars.length.toLocaleString()} closed ${timeframe} candles · ${last ? stamp(last.closeTime) : "—"} UTC`}
            </span>
            <span className="pf-status-actions">
              {source.kind === "public" && <button onClick={() => setRevision((n) => n + 1)} disabled={busy}>↻ Refresh</button>}
              <button onClick={exportData} disabled={!bars.length}>Export JSON ↓</button>
              {!panelOpen && <button onClick={() => setPanelOpen(true)} aria-label="Open analysis">Show panel ›</button>}
            </span>
          </footer>
        </section>

        {panelOpen && (
          <aside className="pf-panel" aria-label="Analysis">
            <div className="pf-tabs" role="tablist" aria-label="Analysis views">
              {([
                ["patterns", "Patterns"],
                ["trend", "Trend"],
                ["timeframes", "Timeframes"],
                ...(source.kind === "case" ? [["case", "Case"]] : []),
              ] as [Tab, string][]).map(([value, label]) => (
                <button key={value} role="tab" aria-selected={tab === value} onClick={() => openTab(value)}>{label}</button>
              ))}
              <button className="pf-close" aria-label="Close analysis" onClick={() => setPanelOpen(false)}>×</button>
            </div>
            <div className="pf-panel-body">
              {busy || error ? (
                <p className="pf-muted">Load a market to see its analysis.</p>
              ) : tab === "patterns" ? (
                <>
                  <div className="pf-filter" role="group" aria-label="Candlestick pattern">
                    <button aria-pressed={patternName === "all"} onClick={() => choosePattern("all")}>All</button>
                    {PATTERN_NAMES.map((name) => (
                      <button key={name} aria-pressed={patternName === name} onClick={() => choosePattern(name)}>
                        <i className={`pf-dot ${tone(name)}`} aria-hidden="true" />
                        {name.replace(" shape", "").replace("-shape", "")}
                        <small>{counts[name] ?? 0}</small>
                      </button>
                    ))}
                  </div>
                  {patternName !== "all" && <p className="pf-help">{PATTERN_HELP[patternName]}</p>}
                  {canPreview && (
                    <label className="pf-check">
                      <input type="checkbox" checked={previewForming} onChange={(e) => setPreviewForming(e.target.checked)} />
                      Preview the forming 4h candle (amber)
                    </label>
                  )}
                  <h3 className="pf-list-title">{patterns.length ? `${patterns.length} found · newest first` : "No matches in the visible history"}</h3>
                  <ul className="pf-hits">
                    {patterns.slice().reverse().slice(0, showAllHits ? undefined : PATTERN_LIST_LIMIT).map((pattern, i) => {
                      const selected = Number(pattern.time) === focusedPatternTime;
                      return (
                        <li key={`${pattern.time}-${pattern.name}-${i}`}>
                          <button
                            className={`mw-pattern-hit ${selected ? "is-active" : ""}`}
                            aria-pressed={selected}
                            onClick={() => { setPreviewForming(false); setHighlightTime(Number(pattern.time)); setLayers((v) => ({ ...v, patterns: true })); }}
                          >
                            <i className={`pf-dot ${tone(pattern.direction)}`} aria-hidden="true" />
                            <span>
                              <strong>{pattern.name}</strong>
                              <time>{stamp(Number(pattern.time))} UTC</time>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {patterns.length > PATTERN_LIST_LIMIT && (
                    <button className="pf-secondary pf-more" onClick={() => setShowAllHits((v) => !v)}>
                      {showAllHits ? "Show fewer" : `Show all ${patterns.length}`}
                    </button>
                  )}
                  <details className="pf-rules">
                    <summary>How patterns are detected</summary>
                    <p>Doji: body ≤ 10% of range. Hammer / shooting star: long wick ≥ 2× body, opposite wick ≤ body. Engulfing: the body contains the previous opposite body. Thresholds are descriptive, not calibrated: a shape does not predict the next candle.</p>
                  </details>
                </>
              ) : tab === "trend" ? (
                <>
                  <div className={`pf-verdict ${tone(murphy.trend === "Rising" ? "bull" : murphy.trend === "Falling" ? "bear" : "")}`}>
                    <small>Last closed {timeframe} candle</small>
                    <strong>{murphy.setup}</strong>
                    <p>{murphy.because}</p>
                  </div>
                  <dl className="pf-steps">
                    <div><dt>1 · Direction</dt><dd>{murphy.trend}</dd><p>Close vs EMA {fastPeriod} and EMA {slowPeriod}.</p></div>
                    <div><dt>2 · Location</dt><dd>{murphy.location}</dd><p>Where the close sits in the 20-candle Bollinger envelope.</p></div>
                    <div><dt>3 · Momentum</dt><dd>{murphy.rsi === undefined ? "RSI warming up" : `RSI ${murphy.rsi.toFixed(1)}`}</dd><p>Wilder RSI 14: above 70 is strong, below 30 weak — not an automatic signal.</p></div>
                  </dl>
                  <button className="pf-wide pf-secondary" onClick={() => setLayers((v) => ({ ...v, ema: !(v.ema && v.bollinger), bollinger: !(v.ema && v.bollinger) }))}>
                    {layers.ema && layers.bollinger ? "Hide EMA and bands" : "Show EMA and bands on the chart"}
                  </button>
                  <p className="pf-muted">A reading order inspired by John J. Murphy: direction first, then location and momentum. Descriptive, not a trading signal.</p>
                </>
              ) : tab === "timeframes" ? (
                <>
                  <p className="pf-muted">The same market at different speeds. Click a row to switch.</p>
                  <div className="pf-matrix">
                    {intervals.map((tf) => {
                      const row = summarize(frames[tf] ?? []);
                      return (
                        <button key={tf} onClick={() => changeTimeframe(tf)} disabled={!!active?.failures?.[tf]} aria-pressed={timeframe === tf}>
                          <strong>{tf}</strong>
                          <span className={row.trend === "Rising" ? "up" : row.trend === "Falling" ? "down" : ""}>
                            {active?.failures?.[tf] ? "Unavailable" : row.trend}
                            <small>{row.count} candles · RSI {row.rsi?.toFixed(1) ?? "—"}</small>
                          </span>
                          <b>{price(row.last?.c)}</b>
                        </button>
                      );
                    })}
                  </div>
                  <p className="pf-muted">Only candles closed at the replay position are included. Higher timeframes with missing hours are left out.</p>
                </>
              ) : (
                <>
                  <div className="pf-verdict bear">
                    <small>28 July 2026 · BTC 5m</small>
                    <strong>A breakout that did not hold</strong>
                    <p>Price broke a prior resistance line, retested it, then closed back below. Kept as a failed setup, not a success story.</p>
                  </div>
                  <button className="pf-primary pf-wide" onClick={startReplay}>⏵ Replay the case</button>
                  <p className="pf-muted">Watch 19:00–19:10 UTC. No paper return, execution or target hit is inferred.</p>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
