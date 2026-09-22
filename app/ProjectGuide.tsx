import "./about/about.css";

const repo = "https://github.com/coder058/pattern-forge/blob/main/";

export function ProjectGuide() {
  return <details className="mw-build-guide" id="how-it-works">
    <summary>How I built it — data flow, database and checks</summary>
    <div className="pf-guide">
      <section><h2>From a price record to a chart</h2>
        <p>Fetch the data → check each candle → calculate the reading → draw it. During replay, every calculation stops at the slider: later candles are excluded.</p>
        <div className="pf-table" role="region" aria-label="Data paths" tabIndex={0}><table>
          <thead><tr><th>Input</th><th>What you see</th><th>What stays separate</th></tr></thead><tbody>
            <tr><th>Hyperliquid API</th><td>Snapshots of closed BTC, ETH and SOL candles.</td><td>Refresh reloads the chart; it is not a tick-by-tick feed.</td></tr>
            <tr><th>Hyperliquid WebSocket</th><td>A current mid-price label.</td><td>The quote never changes historical replay.</td></tr>
            <tr><th>Saved recordings</th><td>Dated Polymarket Perps contracts and a saved BTC case.</td><td>Historical prices, not current spot gold, oil or cash indices.</td></tr>
            <tr><th>PostgreSQL</th><td>Stored candles when running locally or in CI.</td><td>The public demo does not serve this database.</td></tr>
          </tbody></table></div>
      </section>
      <section><h2>What we used, and why</h2>
        <div className="pf-table" role="region" aria-label="Component dependencies" tabIndex={0}><table>
          <thead><tr><th>Part</th><th>Built with</th><th>Depends on</th></tr></thead><tbody>
            <tr><th>Market selector and replay</th><td>React, TypeScript and Next.js</td><td>Validated candles and your selected time.</td></tr>
            <tr><th>Chart and pattern markers</th><td>Lightweight Charts</td><td>Our indicator calculations and candle-shape rules.</td></tr>
            <tr><th>Stored-data pipeline</th><td>Python and PostgreSQL</td><td>The public API, validation and a configured local database.</td></tr>
            <tr><th>Repeatable checks</th><td>Node tests, Playwright, Docker and GitHub Actions</td><td>Synthetic test cases, saved recordings and a test database.</td></tr>
          </tbody></table></div>
      </section>
      <section><h2>The database: two tables</h2>
        <div className="pf-table" role="region" aria-label="Database schema" tabIndex={0}><table>
          <thead><tr><th>Table</th><th>Stores</th><th>How it connects</th></tr></thead><tbody>
            <tr><th><code>candles</code></th><td>Market, interval, time, open/high/low/close and volume.</td><td>One row per market + interval + start time. Changed values update that row; duplicates do not multiply it.</td></tr>
            <tr><th><code>ingest_runs</code></th><td>Each fetch attempt: source, timings, row counts and errors.</td><td>Shares market and interval with candles; there is no foreign key linking a run to individual candle versions.</td></tr>
          </tbody></table></div>
        <p>This is a current-value store, not an immutable revision ledger: it cannot recover overwritten values. Candles and logs commit separately, so a crash can leave a missing log. Prices use double precision for charts, not money settlement.</p>
        <p><a href={repo + "ingest/schema.sql"}>SQL schema</a> · <a href={repo + "ingest/store.py"}>Storage code</a></p>
      </section>
      <section><h2>Decisions we check</h2>
        <div className="pf-table" role="region" aria-label="Engineering decisions and tests" tabIndex={0}><table>
          <thead><tr><th>Decision</th><th>Why</th><th>Check</th></tr></thead><tbody>
            <tr><th>Replay sees only the past</th><td>Later prices must not change an earlier reading.</td><td>Compare calculations before and after adding future candles.</td></tr>
            <tr><th>Leave gaps visible</th><td>Missing prices are not invented.</td><td>Reject incomplete time groups and patterns that cross a gap.</td></tr>
            <tr><th>Mark unfinished candles</th><td>A forming pattern can disappear.</td><td>The amber 4h preview stays outside confirmed signals and exports.</td></tr>
            <tr><th>Show failures clearly</th><td>A disconnected feed is not live data.</td><td>Test timeouts, broken streams, invalid responses and database restarts.</td></tr>
          </tbody></table></div>
        <p><a href="https://github.com/coder058/pattern-forge/actions/workflows/check.yml">Automated checks</a> · <a href={repo + "docs/reading-rules.md"}>Pattern rules and references</a></p>
        <p>Murphy context is a small, reference-inspired reading of trend and price location, not the full textbook. Candle patterns describe shapes, not profitable trades. This workspace does not forecast prices or place orders.</p>
      </section>
    </div>
  </details>;
}
