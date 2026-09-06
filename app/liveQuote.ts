// SOURCE: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
const FEED_URL = "wss://api.hyperliquid.xyz/ws";
// GUESS: UNCALIBRATED GUESS — retry pacing, not measured service performance.
const RETRY_BASE_MS = 1_000, RETRY_MAX_MS = 30_000;
// SOURCE: provider disconnects idle connections after 60 seconds. Heartbeat stays below it.
// GUESS: UNCALIBRATED GUESS — local detection thresholds need operational calibration.
const HEARTBEAT_MS = 20_000, QUOTE_TIMEOUT_MS = 45_000;
type Socket = Pick<WebSocket, "onopen" | "onmessage" | "onerror" | "onclose" | "send" | "close">;
export type QuoteState = {
  status: "connecting" | "live" | "reconnecting";
  price?: number;
  receivedAt?: number;
};

export function readMid(raw: unknown, symbol: string): number | undefined {
  if (typeof raw !== "string") return;
  try {
    const message = JSON.parse(raw);
    if (message.channel !== "allMids") return;
    const value = message.data?.mids?.[symbol];
    if (typeof value !== "string" || !value.trim()) return;
    const mid = Number(value);
    return Number.isFinite(mid) && mid > 0 ? mid : undefined;
  } catch { return; }
}

/** One read-only stream per mounted public market. No wallet or order capability. */
export function connectQuote(
  symbol: string,
  emit: (state: QuoteState) => void,
  connect: (url: string) => Socket = url => new WebSocket(url),
  now = Date.now,
) {
  if (!["BTC", "ETH", "SOL"].includes(symbol)) throw new Error("Unsupported public market.");
  let stopped = false;
  let socket: Socket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let retryDelay = RETRY_BASE_MS;
  let lastQuote = now();

  const disconnect = () => {
    if (heartbeat) clearInterval(heartbeat);
    const previous = socket;
    socket = null;
    if (previous) {
      previous.onopen = previous.onmessage = previous.onclose = previous.onerror = null;
      previous.close();
    }
  };
  const recover = () => {
    disconnect();
    if (stopped || retry) return;
    // Clear the last price: disconnected data must never look like a live quote.
    emit({ status: "reconnecting" });
    retry = setTimeout(() => { retry = undefined; start(); }, retryDelay);
    // SOURCE: exponential retry schedule, capped to RETRY_MAX_MS.
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  };
  const start = () => {
    if (stopped) return;
    emit({ status: "connecting" });
    lastQuote = now();
    try { socket = connect(FEED_URL); } catch { recover(); return; }
    const current = socket;
    current.onopen = () => {
      if (stopped || socket !== current) return;
      try { current.send(JSON.stringify({ method: "subscribe", subscription: { type: "allMids" } })); }
      catch { recover(); }
    };
    current.onmessage = event => {
      if (stopped || socket !== current) return;
      const price = readMid(event.data, symbol);
      if (price === undefined) return;
      lastQuote = now();
      retryDelay = RETRY_BASE_MS;
      emit({ status: "live", price, receivedAt: lastQuote });
    };
    current.onclose = current.onerror = () => { if (socket === current) recover(); };
    heartbeat = setInterval(() => {
      if (now() - lastQuote > QUOTE_TIMEOUT_MS) { recover(); return; }
      try { current.send(JSON.stringify({ method: "ping" })); } catch { recover(); }
    }, HEARTBEAT_MS);
  };
  start();
  return () => { stopped = true; if (retry) clearTimeout(retry); disconnect(); };
}
