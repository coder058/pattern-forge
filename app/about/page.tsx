import "./about.css";

export const metadata = { title: "How Pattern Forge works — data, database and decisions" };

const repo = "https://github.com/coder058/pattern-forge/blob/main/";

export default function About() {
  return <main className="pf-guide">
    <nav><a href="/">← Open the chart</a><a href="https://github.com/coder058/pattern-forge">Source code ↗</a></nav>
    <header><p>Pattern Forge / Engineering walkthrough</p><h1>A chart that only knows<br />what happened so far.</h1>
      <p>Pattern Forge lets you inspect market data, identify candle shapes and rewind a recording. The engineering problem is keeping live quotes, closed candles and historical replay separate: a replay must never use a later candle to explain an earlier one.</p>
    </header>
    <section><h2>Try it, step by step</h2><ol>
      <li><strong>Choose a market and interval.</strong> Public BTC, ETH and SOL load closed-candle snapshots. Recorded markets use dated files; they are not live prices.</li>
      <li><strong>Choose Candlestick patterns → Bullish engulfing.</strong> The chart focuses the latest matching pair. The current up-body contains the previous down-body. Equal boundaries count; no reversal or future return is implied. If there is no match, the app says so.</li>
      <li><strong>Read Murphy context.</strong> Switch to Trend &amp; location to inspect price versus moving averages, Bollinger location and RSI. This is a compact interpretation inspired by the reference, not the whole textbook.</li>
      <li><strong>Rewind a recording.</strong> Step forward and watch the available readings change. Missing source bars stay missing. Use Indicators if you want supporting lines; drawing is not required.</li>
      <li><strong>Watch a provisional body.</strong> For an hourly recording, select 4h and an engulfing pattern, then enable Preview forming 4h. The amber candle uses only closed hourly observations. Its shape may disappear before the 4h close; this is not a tick-by-tick reconstruction.</li>
      <li><strong>Inspect or export.</strong> Export the closed candles available at the cursor, with source metadata. Compare the export with the chart instead of trusting a screenshot.</li>
    </ol></section>
    <section><h2>Where the data comes from</h2><p className="pf-table-hint">On a narrow screen, swipe the tables sideways to read every column. With a keyboard, focus the table and use the arrow keys.</p><div className="pf-table" role="region" aria-label="Data paths" tabIndex={0}><table>
      <thead><tr><th>Path</th><th>Reads → produces</th><th>Boundary</th></tr></thead><tbody>
        <tr><th>Public candles</th><td>Hyperliquid HTTP → Next.js validation → closed OHLCV candles</td><td>Only configured markets and intervals. Incomplete or malformed candles are rejected; unavailable intervals remain visible.</td></tr>
        <tr><th>Live quote</th><td>Hyperliquid WebSocket → current mid-price label</td><td>Separate from the candles. A disconnected or silent stream loses live status; it never rewrites replay.</td></tr>
        <tr><th>Historical replay</th><td>Committed market recording → prefix at the cursor → indicators and shapes</td><td>Polymarket Perps contracts, not spot commodities or cash indices. Higher intervals require complete contiguous groups.</td></tr>
        <tr><th>Stored candles</th><td>Python ingester → PostgreSQL → read-only Next.js API → same chart</td><td>Local/CI path only. The public demo does not serve this database.</td></tr>
      </tbody></table></div></section>
    <section><h2>What depends on what</h2><div className="pf-table" role="region" aria-label="Component dependencies" tabIndex={0}><table>
      <thead><tr><th>Component</th><th>Needs</th><th>Responsibility / source</th></tr></thead><tbody>
        <tr><th>Market workspace</th><td>Validated candles, market selection, replay cursor</td><td>Coordinates the user journey; <a href={repo + "app/MarketWorkspace.tsx"}>React state</a>.</td></tr>
        <tr><th>Analysis functions</th><td>Only the available candle prefix</td><td>Aggregation, indicator warm-up and geometric rules; <a href={repo + "app/marketAnalysis.ts"}>calculation core</a>.</td></tr>
        <tr><th>Chart</th><td>Calculated series and selected reading</td><td>Draws candles, markers and optional layers; it is not the source of market truth. <a href={repo + "app/ProfessionalChart.tsx"}>Rendering component</a>.</td></tr>
        <tr><th>Python ingestion</th><td>Public candle endpoint and configured PostgreSQL</td><td>Fetches, validates, retries bounded failures and records attempts; <a href={repo + "ingest/ingest.py"}>ingester</a>.</td></tr>
        <tr><th>Stored-data API</th><td>DATABASE_URL and initialized tables</td><td>Returns bounded candle histories; distinguishes empty storage from a database failure. <a href={repo + "app/storedApi.ts"}>API contract</a>.</td></tr>
      </tbody></table></div></section>
    <section><h2>The database: two tables, different jobs</h2><p>The schema is deliberately small. There is no invented users/orders/trades database behind this read-only workspace.</p>
      <div className="pf-table" role="region" aria-label="Database schema" tabIndex={0}><table>
        <thead><tr><th>Table</th><th>Key and fields</th><th>Writes and relationships</th></tr></thead><tbody>
          <tr><th><code>candles</code></th><td>Primary key: <code>(symbol, interval, open_time)</code>. Close time, open/high/low/close, volume and ingested_at.</td><td>One current row per candle. Identical deliveries cause no update; changed OHLCV updates that row. The recent-candle index serves market/interval queries.</td></tr>
          <tr><th><code>ingest_runs</code></th><td>Primary key: <code>id</code>. Symbol, interval, source, start/end times, fetch/write durations, row counts and error.</td><td>Records ingestion attempts, including failures. Shares symbol/interval values with candles, but has no foreign key to individual candle versions.</td></tr>
        </tbody></table></div>
      <p><strong>Trade-off:</strong> this is a current-candle store, not an immutable revision ledger. A run does not reconstruct overwritten values. Candles and the run log commit separately, so a process crash between commits can leave candles without the final run record. Prices use double precision for chart analysis, not exact-money settlement.</p>
      <p><a href={repo + "ingest/schema.sql"}>Read the SQL schema</a> · <a href={repo + "ingest/store.py"}>Read the upsert and queries</a></p>
    </section>
    <section><h2>Decisions and how they are checked</h2><div className="pf-table" role="region" aria-label="Engineering decisions and tests" tabIndex={0}><table>
      <thead><tr><th>Decision</th><th>Why</th><th>Check</th></tr></thead><tbody>
        <tr><th>Prefix-only replay</th><td>Future observations must not affect an earlier reading.</td><td>Indicator prefix invariance, close-time boundaries and later pivot confirmation.</td></tr>
        <tr><th>No gap filling</th><td>A plausible-looking invented candle would hide missing evidence.</td><td>Incomplete higher-interval groups are omitted; engulfing cannot bridge a gap.</td></tr>
        <tr><th>Pure calculations</th><td>Indicator behavior should be reproducible without a network or chart.</td><td>SMA-seeded EMA, Wilder RSI, Bollinger and MACD mechanics on synthetic fixtures.</td></tr>
        <tr><th>Database-level duplicate guard</th><td>Repeated fetches must not multiply rows.</td><td>PostgreSQL ingestion tests and restart checks in the integration workflow.</td></tr>
        <tr><th>Explicit failure states</th><td>A dead source is not a successful empty/live response.</td><td>Timeouts, broken streams, malformed payloads, database failures and historical fallback.</td></tr>
      </tbody></table></div>
      <p><a href="https://github.com/coder058/pattern-forge/actions/workflows/check.yml">Inspect CI results</a> · <a href={repo + "e2e/workspace.test.mjs"}>Browser workflow checks</a> · <a href={repo + "docs/reading-rules.md"}>Reading rules and reference limits</a></p>
    </section>
    <section><h2>What this demonstrates — and what it does not</h2><p>React/TypeScript UI state, REST and WebSocket integration, Python ingestion, SQL persistence and tests around time boundaries. Docker and PostgreSQL verification belong to the local/CI path, not to a claim of a deployed database.</p>
      <p>Candle shapes describe geometry. This project does not establish profitability, forecast accuracy, order execution, HFT latency or production uptime. Reproduce the behavior and inspect the linked tests rather than treating a test count as a quality score.</p></section>
    <footer><a href="/">Try the workspace →</a></footer>
  </main>;
}
