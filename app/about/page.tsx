import type { Metadata } from "next";
import { ProjectGuide } from "../ProjectGuide";
import catalog from "../../public/recordings/catalog.json";
import "./about.css";

export const metadata: Metadata = {
  title: "How it works",
  description: "Why Pattern Forge replays charts without hindsight, how the data flows and what is tested.",
};

export default function About() {
  return (
    <main className="pf-about">
      <nav><a href="/">← Back to the chart</a><a href="https://github.com/coder058/pattern-forge">Code on GitHub ↗</a></nav>
      <header>
        <p className="pf-about-kicker">How it works</p>
        <h1>Would this pattern have been visible before the next price arrived?</h1>
        <p>A finished chart makes the past look obvious. Pattern Forge rewinds it and shows only what was
          available at the selected time, so a candlestick pattern or a trend reading can be judged the way
          a trader would have seen it — not with hindsight.</p>
      </header>
      <section className="pf-guide">
        <h2>The problem, and what you can check</h2>
        <div className="pf-table" role="region" aria-label="Problem and solution" tabIndex={0}><table>
          <thead><tr><th>Problem</th><th>What I built</th><th>What you can check</th></tr></thead>
          <tbody>
            <tr><th>Hindsight makes patterns look easier to spot.</th><td>A bar replay that stops every calculation at the selected candle.</td><td>Press Replay: markers appear only after their candle closes.</td></tr>
            <tr><th>Missing prices can produce misleading shapes.</th><td>Checks for incomplete candles and gaps.</td><td>Missing periods stay missing; incomplete groups are not filled with invented prices.</td></tr>
            <tr><th>A current quote can be confused with a recording.</th><td>Separate live quotes, recordings and stored records.</td><td>Every market is labelled Live, Replay or Case. The PostgreSQL store runs locally and in CI, not on this public demo.</td></tr>
          </tbody>
        </table></div>
        <h2>Markets</h2>
        <p>3 public crypto markets (BTC, ETH, SOL) with the latest closed candles from Hyperliquid, and
          {" "}{catalog.length} hourly recordings: {catalog.map((c) => c.label).join(", ")}. The recordings are
          Polymarket Perps contracts, not spot gold, oil or cash indices, and they end in August 2026.</p>
        <p>Pattern shapes and the Murphy-style reading describe the chart. They do not predict a profitable trade,
          and nothing here places orders.</p>
      </section>
      <ProjectGuide open />
    </main>
  );
}
