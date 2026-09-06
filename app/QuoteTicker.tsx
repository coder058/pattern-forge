"use client";
import { useEffect, useState } from "react";
import { connectQuote, type QuoteState } from "./liveQuote";

export function LiveQuote({ symbol }: { symbol: string }) {
  const [quote, setQuote] = useState<QuoteState>({ status: "connecting" });
  useEffect(() => connectQuote(symbol, setQuote), [symbol]);
  return <div className="mw-live-quote">
    <span>Live mid-price</span>
    <strong>{quote.status === "live" ? new Intl.NumberFormat("en-US", {
      // SOURCE: display precision only; no price rounding is used by calculations.
      maximumFractionDigits: 3,
    }).format(quote.price!) : "—"}</strong>
    <span role="status">{quote.status === "live" ? "Connected" : quote.status === "connecting" ? "Connecting…" : "Disconnected · retrying"}</span>
    {quote.receivedAt !== undefined && <time dateTime={new Date(quote.receivedAt).toISOString()}>Received {new Date(quote.receivedAt).toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC</time>}
    <p>Quote updates automatically. The chart shows closed candles from your last refresh.</p>
  </div>;
}
