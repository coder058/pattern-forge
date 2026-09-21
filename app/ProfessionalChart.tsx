"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from "lightweight-charts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

export type ProfessionalChartCandle = {
  t: string | number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  closed: boolean;
};

export type ProfessionalChartPoint = {
  time: string | number;
  value: number;
};

export type ProfessionalChartTrendline = {
  kind: string;
  startTime: string | number;
  startPrice: number;
  endTime: string | number;
  endPrice: number;
  confirmedAt?: string | number;
};

export type ProfessionalChartPattern = {
  name: string;
  direction: string;
  time: string | number;
  price: number;
  variant?: string;
  knownAt?: string | number;
};

export type ProfessionalChartTouch = {
  ordinal: string;
  levelKind: string;
  direction: string;
  time: string | number;
  knownAt: string | number;
  price: number;
  lowerBand?: number;
  upperBand?: number;
  pivotTime?: string | number;
  pivotConfirmedAt?: string | number;
};

export type ProfessionalChartPlan = {
  direction: string;
  signalTime: string | number;
  entry: number;
  stop: number;
  target: number;
  targetMethod?: string;
  status?: string;
};

export type ProfessionalChartCaseStudy = {
  targetPlan: number;
  retestTime: string | number;
  retestClose: number;
  invalidationTime: string | number;
  invalidationClose: number;
  status: "invalidated_false_break";
};

export type ProfessionalChartData = {
  candles: ProfessionalChartCandle[];
  overlays: {
    ema: ProfessionalChartPoint[];
    emaSlow: ProfessionalChartPoint[];
    bollinger: {
      upper: ProfessionalChartPoint[];
      middle: ProfessionalChartPoint[];
      lower: ProfessionalChartPoint[];
    };
    trendlines: ProfessionalChartTrendline[];
    patterns: ProfessionalChartPattern[];
    touches: ProfessionalChartTouch[];
    plans: ProfessionalChartPlan[];
    caseStudy?: ProfessionalChartCaseStudy;
  };
};

export type ProfessionalLayerState = {
  ema: boolean;
  bollinger: boolean;
  trendlines: boolean;
  patterns: boolean;
  touches: boolean;
  plans: boolean;
};

export type ProfessionalDrawTool =
  | "inspect"
  | "trend"
  | "horizontal"
  | "measure";

type DrawingPoint = { time: UTCTimestamp; price: number };
type Drawing = {
  id: string;
  timeframe: string;
  tool: Exclude<ProfessionalDrawTool, "inspect">;
  start: DrawingPoint;
  end: DrawingPoint;
};
type PatternGroup = {
  id: string;
  knownTime: UTCTimestamp;
  patterns: ProfessionalChartPattern[];
};

export type ChartReading = {
  kicker: string;
  setup: string;
  steps: { n: string; label: string; value: string }[];
  because: string;
  anchor?: { time: number; label: string };
  provisional?: boolean;
};

type ChartRefs = {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick", Time>;
  volume: ISeriesApi<"Histogram", Time> | null;
  oscillator: ISeriesApi<"Line", Time> | null;
  oscillatorSignal: ISeriesApi<"Line", Time> | null;
  ema: ISeriesApi<"Line", Time>;
  emaSlow: ISeriesApi<"Line", Time>;
  bbUpper: ISeriesApi<"Line", Time>;
  bbMiddle: ISeriesApi<"Line", Time>;
  bbLower: ISeriesApi<"Line", Time>;
  markerPlugin: ISeriesMarkersPluginApi<Time>;
};

// # GUESS: UNCALIBRATED GUESS — the initial 96-bar viewport is presentation-only so individual
// candles remain readable; it is not a trading lookback or calibrated input.
const INITIAL_VISIBLE_BARS = 96;
// # GUESS: UNCALIBRATED GUESS — six future slots are presentation whitespace for current-price and
// target labels; they do not alter evidence or plan calculations.
const RIGHT_OFFSET_BARS = 6;
// # GUESS: UNCALIBRATED GUESS — showing two recent causal structure lines is a visual decluttering
// policy. The complete supplied structure remains available in the inspector.
const DEFAULT_VISIBLE_TRENDLINES = 2;
// SOURCE: These zoom ratios are user-interface increments only.
const ZOOM_IN_RATIO = 0.72;
const ZOOM_OUT_RATIO = 1.38;

function toEpoch(value: string | number): number {
  if (typeof value === "number") {
    return value < 100_000_000_000 ? value * 1000 : value;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toChartTime(value: string | number): UTCTimestamp {
  return Math.floor(toEpoch(value) / 1000) as UTCTimestamp;
}

function formatPrice(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 3,
  }).format(value);
}

function formatTime(value: string | number): string {
  const epoch = toEpoch(value);
  if (!epoch) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }).format(epoch);
}

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactLineData(points: ProfessionalChartPoint[]): LineData<Time>[] {
  const byTime = new Map<number, number>();
  points.forEach((point) => {
    const time = toChartTime(point.time);
    if (Number.isFinite(point.value)) byTime.set(time, point.value);
  });
  return [...byTime.entries()]
    .sort(([left], [right]) => left - right)
    .map(([time, value]) => ({ time: time as UTCTimestamp, value }));
}

function directionTone(direction: string): "bull" | "bear" | "neutral" {
  const normalized = direction.toLowerCase();
  if (normalized.includes("bull") || normalized.includes("long")) return "bull";
  if (normalized.includes("bear") || normalized.includes("short")) return "bear";
  return "neutral";
}

function shortPatternName(name: string): string {
  if (name === "Doji") return "Doji";
  if (name.startsWith("Hammer")) return "Hammer";
  if (name.toLowerCase().includes("star")) return "Star";
  if (name.startsWith("Bullish")) return "Engulf↑";
  if (name.startsWith("Bearish")) return "Engulf↓";
  return name.split(" ")[0] ?? name;
}

function buildPatternGroups(
  patterns: ProfessionalChartPattern[],
): PatternGroup[] {
  const groups = new Map<number, ProfessionalChartPattern[]>();
  patterns.forEach((pattern) => {
    // SOURCE: the candle series is keyed by open time. closeTime is when the
    // shape became known; it is not a time that exists on the series.
    const seriesTime = toChartTime(pattern.time);
    const current = groups.get(seriesTime) ?? [];
    current.push(pattern);
    groups.set(seriesTime, current);
  });
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([seriesTime, grouped]) => ({
      id: `pattern-${seriesTime}`,
      knownTime: seriesTime as UTCTimestamp,
      patterns: grouped,
    }));
}

function markerForGroup(
  group: PatternGroup,
  named: boolean,
): SeriesMarker<Time> {
  const tones = new Set(group.patterns.map((pattern) => directionTone(pattern.direction)));
  const tone = tones.size === 1 ? [...tones][0] : "neutral";
  const bullish = tone === "bull";
  const bearish = tone === "bear";
  const label =
    group.patterns.length > 1
      ? `${shortPatternName(group.patterns[0].name)}+${group.patterns.length - 1}`
      : shortPatternName(group.patterns[0].name);
  return {
    id: group.id,
    time: group.knownTime,
    position: bullish ? "belowBar" : "aboveBar",
    shape: bullish ? "arrowUp" : bearish ? "arrowDown" : "circle",
    color: bullish ? "#32d3b8" : bearish ? "#ff6573" : "#f4b548",
    text: named ? label : undefined,
    size: named ? 1.2 : 1,
  };
}

export function ProfessionalChart({
  data,
  timeframe,
  layers,
  tool,
  clearToken,
  symbol,
  lowerPanel = "volume",
  oscillatorData,
  reading,
  highlightTime,
  provisionalCandle,
}: {
  data: ProfessionalChartData;
  timeframe: string;
  layers: ProfessionalLayerState;
  tool: ProfessionalDrawTool;
  clearToken: number;
  symbol: string;
  lowerPanel?: "none" | "volume" | "rsi" | "macd";
  oscillatorData?: { line: ProfessionalChartPoint[]; signal?: ProfessionalChartPoint[]; histogram?: ProfessionalChartPoint[] };
  reading?: ChartReading | null;
  highlightTime?: number | null;
  provisionalCandle?: ProfessionalChartCandle;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartRefs | null>(null);
  const trendSeriesRef = useRef<ISeriesApi<"Line", Time>[]>([]);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const pointerRef = useRef<{
    pointerId: number;
    start: DrawingPoint;
  } | null>(null);
  const draftRef = useRef<Drawing | null>(null);
  const drawingsRef = useRef<Drawing[]>([]);
  const groupsRef = useRef<PatternGroup[]>([]);
  const activeTimeframeRef = useRef(timeframe);
  const datasetKeyRef = useRef("");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [redoStack, setRedoStack] = useState<Drawing[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<PatternGroup | null>(null);
  const [crosshairBar, setCrosshairBar] =
    useState<ProfessionalChartCandle | null>(null);
  const [visibleRange, setVisibleRange] = useState("—");
  const [chartReady, setChartReady] = useState(false);

  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

  useEffect(() => {
    activeTimeframeRef.current = timeframe;
    setRedoStack([]);
    setSelectedGroup(null);
  }, [timeframe]);

  useEffect(() => { setCrosshairBar(null); }, [timeframe, data.candles]);

  const groups = useMemo(() => {
    const touches: ProfessionalChartPattern[] = layers.touches
      ? data.overlays.touches.map((touch) => ({
          name: `${touch.ordinal} ${touch.levelKind} touch`,
          direction: touch.direction,
          time: touch.time,
          price: touch.price,
          variant: "causal pivot-touch research event",
          knownAt: touch.knownAt,
        }))
      : [];
    return buildPatternGroups([
      ...(layers.patterns ? data.overlays.patterns : []),
      ...touches,
    ]);
  }, [
    data.overlays.patterns,
    data.overlays.touches,
    layers.patterns,
    layers.touches,
  ]);

  const patternsWereOn = useRef(false);
  useEffect(() => {
    groupsRef.current = groups;
    if (
      selectedGroup &&
      !groups.some((group) => group.id === selectedGroup.id)
    ) {
      setSelectedGroup(null);
    }
    if (layers.patterns && !patternsWereOn.current && groups.length) {
      setSelectedGroup(groups.at(-1) ?? null);
    }
    patternsWereOn.current = layers.patterns;
  }, [groups, selectedGroup, layers.patterns]);

  useEffect(() => {
    if (highlightTime == null) return;
    const group = groups.find((item) =>
      item.patterns.some((pattern) => Number(pattern.time) === highlightTime),
    );
    if (group) setSelectedGroup(group);
  }, [highlightTime, groups]);

  const drawOverlay = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    const refs = chartRef.current;
    if (!canvas || !refs) return;
    const bounds = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(bounds.width * dpr));
    canvas.height = Math.max(1, Math.round(bounds.height * dpr));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    const visible = drawingsRef.current.filter(
      (drawing) => drawing.timeframe === activeTimeframeRef.current,
    );
    const pending = draftRef.current ? [draftRef.current] : [];
    [...visible, ...pending].forEach((drawing) => {
      const startX = refs.chart.timeScale().timeToCoordinate(drawing.start.time);
      const endX = refs.chart.timeScale().timeToCoordinate(drawing.end.time);
      const startY = refs.candles.priceToCoordinate(drawing.start.price);
      const endY = refs.candles.priceToCoordinate(drawing.end.price);
      if (
        startX === null ||
        endX === null ||
        startY === null ||
        endY === null
      ) {
        return;
      }
      const finalX = drawing.tool === "horizontal" ? bounds.width : endX;
      const finalY = drawing.tool === "horizontal" ? startY : endY;
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(finalX, finalY);
      context.strokeStyle =
        drawing.tool === "measure" ? "#f4b548" : "#9d96ff";
      context.lineWidth = 1.5;
      context.setLineDash(drawing.tool === "measure" ? [5, 4] : []);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = context.strokeStyle;
      context.beginPath();
      context.arc(startX, startY, 3, 0, Math.PI * 2);
      context.fill();
      if (drawing.tool === "measure" && drawing.start.price !== 0) {
        const change =
          ((drawing.end.price - drawing.start.price) / drawing.start.price) * 100;
        const label = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
        context.font = "600 10px ui-monospace, monospace";
        const width = context.measureText(label).width + 12;
        context.fillStyle = "rgba(42, 34, 18, 0.96)";
        context.fillRect(finalX - width / 2, finalY - 23, width, 18);
        context.fillStyle = "#f4b548";
        context.fillText(label, finalX - width / 2 + 6, finalY - 10);
      }
    });
    // The active timeframe is read through a ref so this callback stays
    // stable; recreating it would tear down and rebuild the whole chart.
  }, []);

  const resetView = useCallback(() => {
    const refs = chartRef.current;
    if (!refs || !data.candles.length) return;
    const lastIndex = data.candles.length - 1;
    const visibleBars = Math.min(INITIAL_VISIBLE_BARS, data.candles.length);
    refs.chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, lastIndex - visibleBars + 1),
      to: lastIndex + RIGHT_OFFSET_BARS,
    });
  }, [data.candles.length]);

  const zoomBy = useCallback((ratio: number) => {
    const refs = chartRef.current;
    const range = refs?.chart.timeScale().getVisibleLogicalRange();
    if (!refs || !range) return;
    const center = (range.from + range.to) / 2;
    const half = ((range.to - range.from) * ratio) / 2;
    refs.chart.timeScale().setVisibleLogicalRange({
      from: center - half,
      to: center + half,
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0b0f16" },
        textColor: "#95a3b8",
        fontFamily: "Consolas, monospace",
        attributionLogo: true,
        panes: {
          separatorColor: "#1a2a31",
          separatorHoverColor: "#2b4852",
          enableResize: true,
        },
      },
      grid: {
        vertLines: { color: "rgba(137, 170, 181, 0.08)" },
        horzLines: { color: "rgba(137, 170, 181, 0.08)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(193, 213, 218, 0.42)",
          labelBackgroundColor: "#20353d",
          style: LineStyle.Dashed,
        },
        horzLine: {
          color: "rgba(193, 213, 218, 0.32)",
          labelBackgroundColor: "#20353d",
          style: LineStyle.Dashed,
        },
      },
      rightPriceScale: {
        borderColor: "#1a2a31",
        scaleMargins: { top: 0.08, bottom: 0.1 },
        minimumWidth: 68,
      },
      timeScale: {
        borderColor: "#1a2a31",
        rightOffset: RIGHT_OFFSET_BARS,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
        mouseWheel: true,
        pinch: true,
      },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#24c4ae",
      downColor: "#fb5968",
      borderVisible: false,
      wickUpColor: "#24c4ae",
      wickDownColor: "#fb5968",
      priceLineVisible: true,
      priceLineColor: "rgba(251, 89, 104, 0.55)",
      lastValueVisible: true,
    });
    const emaSeries = chart.addSeries(LineSeries, {
      color: "#f2a63a",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const emaSlowSeries = chart.addSeries(LineSeries, {
      color: "#a88cff",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const bbUpper = chart.addSeries(LineSeries, {
      color: "rgba(56, 157, 255, 0.66)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const bbMiddle = chart.addSeries(LineSeries, {
      color: "rgba(56, 157, 255, 0.34)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const bbLower = chart.addSeries(LineSeries, {
      color: "rgba(56, 157, 255, 0.66)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const volumeSeries = lowerPanel === "none" ? null : chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: lowerPanel === "volume" ? "volume" : "price" },
        priceLineVisible: false,
        lastValueVisible: false,
      },
      1,
    );
    const oscillator = lowerPanel === "none" ? null : chart.addSeries(LineSeries, {
      color: "#afa0ff", lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
      // SOURCE: RSI is mathematically bounded to 0–100; keep that scale fixed.
      ...(lowerPanel === "rsi" ? {autoscaleInfoProvider: () => ({priceRange: {minValue: 0, maxValue: 100}})} : {}),
    }, 1);
    const oscillatorSignal = lowerPanel === "none" ? null : chart.addSeries(LineSeries, {color:"#edb975",lineWidth:1,priceLineVisible:false,lastValueVisible:false},1);
    if(lowerPanel === "rsi") {
      // SOURCE: conventional reference guides, not calibrated trading thresholds.
      [30, 70].forEach(value => oscillator?.createPriceLine({price:value,color:"#465064",lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:false,title:""}));
    }
    chart.panes()[0]?.setStretchFactor(5);
    chart.panes()[1]?.setStretchFactor(1);
    const markerPlugin = createSeriesMarkers(candleSeries, []);
    chartRef.current = {
      chart,
      candles: candleSeries,
      volume: volumeSeries,
      oscillator,
      oscillatorSignal,
      ema: emaSeries,
      emaSlow: emaSlowSeries,
      bbUpper,
      bbMiddle,
      bbLower,
      markerPlugin,
    };

    const handleRange = () => {
      const range = chart.timeScale().getVisibleLogicalRange();
      setVisibleRange(
        range ? `${range.from.toFixed(2)}:${range.to.toFixed(2)}` : "—",
      );
      window.requestAnimationFrame(drawOverlay);
    };
    const handleCrosshair = (param: Parameters<Parameters<IChartApi["subscribeCrosshairMove"]>[0]>[0]) => {
      const bar = param.seriesData.get(candleSeries);
      if (
        bar &&
        "open" in bar &&
        "high" in bar &&
        "low" in bar &&
        "close" in bar
      ) {
        setCrosshairBar({
          t: Number(bar.time) * 1000,
          o: bar.open,
          h: bar.high,
          l: bar.low,
          c: bar.close,
          closed: true,
        });
      } else {
        setCrosshairBar(null);
      }
      const objectId = param.hoveredInfo?.objectId ?? param.hoveredObjectId;
      if (typeof objectId === "string" && objectId.startsWith("pattern-")) {
        const group = groupsRef.current.find((item) => item.id === objectId);
        if (group) setSelectedGroup(group);
      }
    };
    const handleClick = (param: Parameters<Parameters<IChartApi["subscribeClick"]>[0]>[0]) => {
      const objectId = param.hoveredInfo?.objectId ?? param.hoveredObjectId;
      if (typeof objectId === "string" && objectId.startsWith("pattern-")) {
        const group = groupsRef.current.find((item) => item.id === objectId);
        setSelectedGroup(group ?? null);
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRange);
    chart.subscribeCrosshairMove(handleCrosshair);
    chart.subscribeClick(handleClick);
    setChartReady(true);
    return () => {
      setChartReady(false);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRange);
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.unsubscribeClick(handleClick);
      chart.remove();
      chartRef.current = null;
      // The removed chart destroyed these objects; stale handles must never
      // reach removeSeries/removePriceLine on a later chart instance.
      trendSeriesRef.current = [];
      priceLinesRef.current = [];
      datasetKeyRef.current = "";
    };
  }, [drawOverlay, lowerPanel]);

  useEffect(() => {
    const refs = chartRef.current;
    if (!refs) return;
    const candleRows: CandlestickData<Time>[] = data.candles
      .map((candle) => ({
        time: toChartTime(candle.t),
        open: candle.o,
        high: candle.h,
        low: candle.l,
        close: candle.c,
      }))
      .sort((left, right) => Number(left.time) - Number(right.time));
    const volumeRows: (HistogramData<Time> | WhitespaceData<Time>)[] = data.candles
      .map((candle) => candle.v === undefined ? { time: toChartTime(candle.t) } : ({
        time: toChartTime(candle.t),
        value: candle.v,
        color:
          candle.c >= candle.o
            ? "rgba(36, 196, 174, 0.34)"
            : "rgba(251, 89, 104, 0.34)",
      }))
      .sort((left, right) => Number(left.time) - Number(right.time));
    // SOURCE: preview affects rendering only; data.candles and all calculated series stay closed-only.
    if (provisionalCandle) candleRows.push({ time: toChartTime(provisionalCandle.t),
      open: provisionalCandle.o, high: provisionalCandle.h, low: provisionalCandle.l, close: provisionalCandle.c,
      color: "#e8b35b", borderColor: "#e8b35b", wickColor: "#e8b35b" });
    refs.candles.setData(candleRows);
    refs.volume?.setData(lowerPanel === "volume" ? volumeRows : (oscillatorData?.histogram ?? []).map(point=>({time:toChartTime(point.time),value:point.value,color:point.value>=0?"#378e7d":"#a8556b"})));
    refs.oscillator?.setData(lowerPanel === "rsi" || lowerPanel === "macd" ? compactLineData(oscillatorData?.line ?? []) : []);
    refs.oscillatorSignal?.setData(lowerPanel === "macd" ? compactLineData(oscillatorData?.signal ?? []) : []);
    refs.ema.setData(layers.ema ? compactLineData(data.overlays.ema) : []);
    refs.emaSlow.setData(
      layers.ema ? compactLineData(data.overlays.emaSlow) : [],
    );
    refs.bbUpper.setData(
      layers.bollinger ? compactLineData(data.overlays.bollinger.upper) : [],
    );
    refs.bbMiddle.setData(
      layers.bollinger ? compactLineData(data.overlays.bollinger.middle) : [],
    );
    refs.bbLower.setData(
      layers.bollinger ? compactLineData(data.overlays.bollinger.lower) : [],
    );

    // SOURCE: name only the chosen candle; other markers stay visible without
    // overlapping labels. The result list retains every pattern name.
    const compactPatternMarkers = groups.map((group) =>
      markerForGroup(group, group.id === selectedGroup?.id),
    );
    const contextMarkers: SeriesMarker<Time>[] = reading?.anchor
      ? [{ id: "murphy-context", time: toChartTime(reading.anchor.time),
          position: "aboveBar", shape: "circle", color: reading.provisional ? "#e8b35b" : "#b2a4ff", text: reading.provisional ? "Forming" : "Setup" }]
      : [];
    const activePlan = data.overlays.plans.at(-1);
    const caseStudyPlan = data.overlays.caseStudy;
    const targetMarkers: SeriesMarker<Time>[] =
      layers.plans && activePlan
        ? [
            {
              id: "paper-plan-target",
              time: toChartTime(activePlan.signalTime),
              position: "atPriceMiddle",
              price: activePlan.target,
              shape:
                activePlan.target >= activePlan.entry
                  ? "arrowUp"
                  : "arrowDown",
              color: "#32d3b8",
              text: "T1 PLAN",
              size: 1.2,
            },
          ]
        : layers.plans && caseStudyPlan
          ? [
              {
                id: "case-study-target",
                time: toChartTime(caseStudyPlan.retestTime),
                position: "atPriceMiddle",
                price: caseStudyPlan.targetPlan,
                shape:
                  caseStudyPlan.targetPlan >= caseStudyPlan.retestClose
                    ? "arrowUp"
                    : "arrowDown",
                color: "#32d3b8",
                text: "T1 · NOT REACHED",
                size: 1.2,
              },
            ]
          : [];
    refs.markerPlugin.setMarkers(
      [...compactPatternMarkers, ...targetMarkers, ...contextMarkers].sort(
        (left, right) => Number(left.time) - Number(right.time),
      ),
    );
    trendSeriesRef.current.forEach((series) => refs.chart.removeSeries(series));
    trendSeriesRef.current = [];
    if (layers.trendlines) {
      data.overlays.trendlines
        .slice(-DEFAULT_VISIBLE_TRENDLINES)
        .forEach((line) => {
          const series = refs.chart.addSeries(LineSeries, {
            color: "rgba(139, 129, 255, 0.88)",
            lineWidth: 2,
            lineStyle: line.confirmedAt ? LineStyle.Solid : LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
          series.setData(
            [
              {
                time: toChartTime(line.startTime),
                value: line.startPrice,
              },
              {
                time: toChartTime(line.endTime),
                value: line.endPrice,
              },
            ].sort((left, right) => Number(left.time) - Number(right.time)),
          );
          trendSeriesRef.current.push(series);
        });
    }
    priceLinesRef.current.forEach((line) => refs.candles.removePriceLine(line));
    priceLinesRef.current = [];
    if (layers.plans) {
      const plan = data.overlays.plans.at(-1);
      const caseStudy = data.overlays.caseStudy;
      const levels = plan
        ? [
            {
              price: plan.entry,
              title: "PLAN ENTRY",
              color: "#b8c8ce",
              style: LineStyle.Dashed,
            },
            {
              price: plan.stop,
              title: "PLAN STOP",
              color: "#ff6573",
              style: LineStyle.Dashed,
            },
            {
              price: plan.target,
              title: "PLAN T1",
              color: "#32d3b8",
              style: LineStyle.Dashed,
            },
          ]
        : caseStudy
          ? [
              {
                price: caseStudy.targetPlan,
                title: "PLAN T1 · NOT REACHED",
                color: "#32d3b8",
                style: LineStyle.Dashed,
              },
              {
                price: caseStudy.invalidationClose,
                title: "INVALIDATED",
                color: "#ff6573",
                style: LineStyle.Dotted,
              },
            ]
          : [];
      priceLinesRef.current = levels.map((level) =>
        refs.candles.createPriceLine({
          price: level.price,
          title: level.title,
          color: level.color,
          lineStyle: level.style,
          lineWidth: 1,
          axisLabelVisible: true,
        }),
      );
    }
    const firstCandle = data.candles[0];
    const lastCandle = data.candles.at(-1);
    const datasetKey = `${timeframe}:${data.candles.length}:${String(firstCandle?.t ?? "")}:${String(lastCandle?.t ?? "")}`;
    if (datasetKeyRef.current !== datasetKey) {
      datasetKeyRef.current = datasetKey;
      resetView();
    }
    window.requestAnimationFrame(drawOverlay);
  }, [data, groups, layers, resetView, drawOverlay, timeframe, lowerPanel, oscillatorData, reading, selectedGroup, provisionalCandle]);

  useEffect(() => {
    const refs = chartRef.current;
    if (!refs || highlightTime == null) return;
    const index = data.candles.findIndex(candle => Number(candle.t) === highlightTime);
    if (index < 0) return;
    const range = refs.chart.timeScale().getVisibleLogicalRange();
    // GUESS: UNCALIBRATED GUESS — bounded context makes the two bodies readable;
    // this is viewport spacing, not a detector lookback or a performance claim.
    const span = Math.max(8, Math.min(32, range ? range.to - range.from : INITIAL_VISIBLE_BARS));
    refs.chart.timeScale().setVisibleLogicalRange({ from: index - span / 2, to: index + span / 2 });
    refs.chart.setCrosshairPosition(data.candles[index].c, toChartTime(highlightTime), refs.candles);
    setCrosshairBar(data.candles[index]);
  }, [highlightTime, data.candles]);

  useEffect(() => {
    setDrawings((current) =>
      current.filter(
        (drawing) => drawing.timeframe !== activeTimeframeRef.current,
      ),
    );
    setRedoStack([]);
  }, [clearToken]);

  useEffect(() => {
    window.requestAnimationFrame(drawOverlay);
  }, [drawings, drawOverlay]);

  const pointFromPointer = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): DrawingPoint | null => {
    const refs = chartRef.current;
    if (!refs) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const paneHeight = refs.chart.paneSize(0).height;
    const y = Math.max(0, Math.min(paneHeight, event.clientY - bounds.top));
    const time = refs.chart.timeScale().coordinateToTime(x);
    const price = refs.candles.coordinateToPrice(y);
    if (time === null || typeof time !== "number" || price === null) return null;
    return { time: time as UTCTimestamp, price: Number(price) };
  };

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (tool === "inspect") return;
    const point = pointFromPointer(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = { pointerId: event.pointerId, start: point };
    draftRef.current = {
      id: `drawing-${timeframe}-${event.pointerId}-${Date.now()}`,
      timeframe,
      tool,
      start: point,
      end: point,
    };
    drawOverlay();
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (pointerRef.current?.pointerId !== event.pointerId || !draftRef.current) {
      return;
    }
    const point = pointFromPointer(event);
    if (!point) return;
    draftRef.current = { ...draftRef.current, end: point };
    drawOverlay();
  };

  const finishDrawing = (
    event: ReactPointerEvent<HTMLCanvasElement>,
    commit: boolean,
  ) => {
    if (pointerRef.current?.pointerId !== event.pointerId) return;
    const draft = draftRef.current;
    pointerRef.current = null;
    draftRef.current = null;
    if (draft && commit) {
      setDrawings((current) => [...current, draft]);
      setRedoStack([]);
    }
    drawOverlay();
  };

  const undo = () => {
    const index = drawings
      .map((drawing, itemIndex) =>
        drawing.timeframe === timeframe ? itemIndex : -1,
      )
      .filter((itemIndex) => itemIndex >= 0)
      .at(-1);
    if (index === undefined) return;
    const removed = drawings[index];
    setDrawings((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
    setRedoStack((current) => [...current, removed]);
  };

  const redo = () => {
    const drawing = redoStack.at(-1);
    if (!drawing) return;
    setRedoStack((current) => current.slice(0, -1));
    setDrawings((current) => [...current, drawing]);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      setSelectedGroup(null);
      draftRef.current = null;
      drawOverlay();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    }
    if (event.altKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      resetView();
    }
  };

  // SOURCE: resolve the hovered timestamp against current input after replay/preview changes;
  // never retain an old OHLC snapshot when rewinding or updating a provisional body.
  const displayedBar = (crosshairBar && (
    provisionalCandle && toEpoch(provisionalCandle.t) === toEpoch(crosshairBar.t)
      ? provisionalCandle : data.candles.find(bar => toEpoch(bar.t) === toEpoch(crosshairBar.t))
  )) || provisionalCandle || data.candles.at(-1) || null;
  const activeDrawings = drawings.filter(
    (drawing) => drawing.timeframe === timeframe,
  ).length;

  return (
    <div
      className="professional-chart"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onDoubleClick={resetView}
      data-testid="professional-market-chart"
      data-ready={chartReady}
      data-timeframe={timeframe}
      data-bars={data.candles.length}
      data-provisional-time={provisionalCandle?.t ?? ""}
      data-lower-panel={lowerPanel}
      data-marker-count={layers.patterns ? groups.length : 0}
      data-selected-pattern-time={selectedGroup?.knownTime ?? ""}
      data-layers={Object.entries(layers).filter(([, enabled]) => enabled).map(([name]) => name).join(",")}
      data-setup={reading?.setup ?? ""}
      data-setup-time={reading?.anchor?.time ?? ""}
      data-visible-range={visibleRange}
      aria-label={`${symbol} ${timeframe} interactive candlestick chart`}
    >
      <div className="professional-chart-controls">
        <span className="chart-interaction-hint">
          Drag to pan · wheel/pinch to zoom · double-click to reset
        </span>
        <div role="group" aria-label="Chart navigation">
          <button
            type="button"
            onClick={() => zoomBy(ZOOM_OUT_RATIO)}
            aria-label="Zoom out chart"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => zoomBy(ZOOM_IN_RATIO)}
            aria-label="Zoom in chart"
          >
            +
          </button>
          <button type="button" onClick={resetView}>
            Fit
          </button>
          <button
            type="button"
            onClick={() => chartRef.current?.chart.timeScale().scrollToRealTime()}
          >
            Latest
          </button>
          {(tool !== "inspect" || activeDrawings > 0 || redoStack.length > 0) && <><span className="chart-control-divider" aria-hidden="true" />
          <button
            type="button"
            onClick={undo}
            disabled={!activeDrawings}
            aria-label="Undo chart drawing"
          >
            ↶
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!redoStack.length}
            aria-label="Redo chart drawing"
          >
            ↷
          </button>
          </>}
        </div>
      </div>

      {reading && (
        <section className="chart-reading-strip" data-testid="chart-setup" aria-live="polite">
          <span>{reading.kicker}</span><strong>{reading.setup}</strong>
          {reading.anchor && <time>{formatTime(reading.anchor.time)} UTC · {reading.provisional ? "amber provisional candle" : "violet marker on candle"}</time>}
          <p>{reading.steps.map(step => `${step.label}: ${step.value}`).join(" · ")}</p>
          <details><summary>Why this reading?</summary><p>{reading.because}</p></details>
        </section>
      )}

      <div className="professional-chart-stage">
        <div ref={containerRef} className="lightweight-chart-host" />
        <canvas
          ref={drawingCanvasRef}
          className={`drawing-overlay ${tool === "inspect" ? "is-passive" : "is-drawing"}`}
          aria-label={
            tool === "inspect"
              ? "Drawing overlay inactive"
              : `${humanize(tool)} drawing surface`
          }
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishDrawing(event, true)}
          onPointerCancel={(event) => finishDrawing(event, false)}
        />

        {displayedBar && (
          <div className="pro-crosshair-readout" aria-live="polite">
            <span>{formatTime(displayedBar.t)}{!displayedBar.closed && " · forming"}</span>
            <span>O <b>{formatPrice(displayedBar.o)}</b></span>
            <span>H <b>{formatPrice(displayedBar.h)}</b></span>
            <span>L <b>{formatPrice(displayedBar.l)}</b></span>
            <span>C <b>{formatPrice(displayedBar.c)}</b></span>
          </div>
        )}

        <span className="chart-engine-badge">Interactive engine · closed bars</span>
        {lowerPanel !== "none" && <span className="mw-pane-label">{lowerPanel === "volume" ? "Volume" : lowerPanel === "rsi" ? "RSI 14" : "MACD 12 / 26 / 9"}</span>}
      </div>

      {selectedGroup && layers.patterns && (
          <details className="pattern-detail-card">
            <summary>Evidence for the selected candle</summary>
            <header>
              <span>Pattern on this candle</span>
              <button
                type="button"
                aria-label="Close pattern details"
                onClick={() => setSelectedGroup(null)}
              >
                ×
              </button>
            </header>
            <strong>
              {selectedGroup.patterns.length === 1
                ? humanize(selectedGroup.patterns[0].name)
                : `${selectedGroup.patterns.length} patterns confirmed`}
            </strong>
            <dl>
              <div>
                <dt>Candle</dt>
                <dd>{formatTime(selectedGroup.patterns[0].time)}</dd>
              </div>
              <div>
                <dt>Known at close</dt>
                <dd>
                  {formatTime(
                    selectedGroup.patterns[0].knownAt ??
                      selectedGroup.patterns[0].time,
                  )}
                </dd>
              </div>
            </dl>
            <ul>
              {selectedGroup.patterns.map((pattern, index) => (
                <li key={`${pattern.name}-${String(pattern.time)}-${index}`}>
                  <i className={`tone-${directionTone(pattern.direction)}`} />
                  <span>
                    {humanize(pattern.name)}
                    <small>
                      {pattern.variant
                        ? pattern.variant
                        : humanize(pattern.direction)}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
            <p>Pattern evidence only. It is not an order or profitability claim.</p>
          </details>
        )}

      <p className="sr-only">
        Pan with drag, zoom with the mouse wheel or pinch, inspect with the
        crosshair, and use Fit to restore the latest visible bars.
      </p>
    </div>
  );
}
