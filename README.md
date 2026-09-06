# Pattern Forge — market workspace

Public site: https://pattern-forge-five.vercel.app/

A chart-first workspace for public Hyperliquid quotes, candle snapshots and recorded
Polymarket Perps markets. This is not an order terminal, strategy recommendation,
live account monitor or proof of profitability.

## Interface

- Market search and selector: BTC/ETH/SOL public snapshots; ten recorded markets;
  the original saved BTC case. Only the selected market's candles are requested.
- A separate live mid-price uses Hyperliquid's public WebSocket. Switching to a
  recording closes the connection. A missing or disconnected stream loses its
  live status and clears the price while reconnecting. It never modifies replay.
- One main chart with separate indicator controls. EMA periods, Bollinger Bands,
  confirmed swing geometry and candle markers are optional price overlays.
- A lower pane can show volume, Wilder RSI, MACD or be hidden entirely.
- Analysis is hidden by default; choose timeframe comparison, explained
  trend/location context, candle shapes or the saved BTC case.
- Recorded markets have a replay cursor, previous/next bar and end controls.
  Indicators and higher-timeframe aggregates use only the selected prefix.
- Export contains the current interval's candles through the replay cursor,
  source information and the input hash, not orders or account data.

The public root renders `MarketWorkspace.tsx`. Older local research integration
files are excluded from this publication. It does not render the old inspector,
Scenario Lab, account metrics or localhost polling.

## Recordings

`public/recordings/catalog.json` lists ten authentic hourly market datasets:
gold, silver, WTI oil, S&P 500, Nasdaq 100, BTC, ETH, SOL, HYPE and SPCX.
They are **Polymarket Perps contracts**, not spot gold, cash indices or equity
ownership. The original market-data recordings were downloaded read-only from
the owner's Google Cloud Storage on 28 August 2026. The chart does not expose
bucket access or credentials and does not query the private bucket at runtime.

`scripts/export_recordings.py` converts a supplied directory of Parquet inputs
into the public OHLC-only files. Each entry records the SHA-256 of its input,
date range, count and number of gaps. The last captured candle is conservatively
omitted because it may still have been forming when recorded. Current archives
end on 21–22 August 2026, depending on market. They are not a live feed.

Only complete UTC-aligned groups become 4h/daily candles. Incomplete periods and
missing hours are omitted, never interpolated. Daily candles are complete
24-hour aggregates, not official settlement prices. The last available closed
bar can be older than the replay cursor when an aggregation has gaps.

## Indicators and limitations

EMA is seeded with a full-window SMA. Bollinger Bands use population standard
deviation. RSI uses Wilder smoothing. MACD uses SMA-seeded EMAs, so its warm-up
may differ from vendors using more history or a first-value seed.

Price and EMA ordering is a small descriptive summary inspired by Murphy's
reading sequence; it is not an implementation of an entire trading framework.
Pattern and pivot thresholds are explicitly uncalibrated. No win probabilities,
entry recommendations or model performance are manufactured.

Indicator reference definitions:
[RSI](https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/),
[MACD](https://www.tradingview.com/support/solutions/43000502344-moving-average-convergence-divergence-macd-indicator/),
[Bollinger Bands](https://www.tradingview.com/support/solutions/43000501840-bollinger-bands-bb/).

UI references: [TradingView Supercharts](https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/),
[Koyfin views](https://www.koyfin.com/help/my-views/) and
[Lightweight Charts panes](https://tradingview.github.io/lightweight-charts/tutorials/how_to/panes).
The existing Lightweight Charts dependency and attribution are retained.

## Development

Use the existing Node environment and lockfile. `npm run dev` starts Next;
For a fresh clone, use Node 22.13 or newer and run `npm ci` first.
`npm test` runs mechanics and archive-validation tests; `npm run test:build`
also produces the production build. The ingester's offline tests run with
`python -m unittest discover -s ingest/tests -t .`; the PostgreSQL checks in
`ingest/tests/test_persistence.py` are skipped unless `DATABASE_URL` is set.
Deployment uses the existing linked Vercel project. Keep the raw downloads outside this checkout; public JSON is generated
data, not a hand-edited fixture. Do not run any trading service to test this UI.

## API and deployment

The browser requests `GET /api/markets/BTC` (also ETH and SOL). The Next.js
service validates closed candles from a fixed Hyperliquid endpoint. Other
symbols return 400; a total upstream failure returns 503. Partial success names
the unavailable intervals and is retried on the next request. There is no
arbitrary URL proxy, credential input, order endpoint or trading account.

Simultaneous requests for the same market share upstream work. Complete
snapshots are cached briefly within one process, bounded to the three supported
markets. This is not a distributed cache or database. The response includes
the snapshot's `asOf`; `X-Snapshot-Cache` identifies reuse. `Server-Timing`
measures this handler's elapsed wall time, not exchange or browser latency.
Timeout and cache settings are marked as uncalibrated engineering choices.

`GET /api/health` checks process readiness, not exchange availability.

To run the same app in Docker:

```sh
docker build -t pattern-forge .
docker run --rm -p 127.0.0.1:3000:3000 pattern-forge
```

The multi-stage image runs as a non-root user and excludes local environment
files. [CI](https://github.com/coder058/pattern-forge/actions/workflows/check.yml)
builds that image, runs tests during the build, starts it, and checks readiness,
the page and an invalid-market request. A second job starts a real PostgreSQL
service, ingests the recorded payload twice, reads it back from a separate
process, restarts the database and reads it again. Vercel remains the public
deployment; it does not use this Docker image and does not serve stored candles.
No new paid service is required.

The quote feed uses the documented
[allMids subscription](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions).
It supplies a venue mid-price, not a last-trade price. Its displayed timestamp
is local receipt time, not a latency measurement. Heartbeats, capped retries,
malformed-message rejection and cleanup are covered by synthetic tests.

I kept streaming quotes separate from candle snapshots: they answer different
questions, and mixing a current quote into an archived candle would make replay
misleading. I used an API to centralize validation and share duplicate requests,
not to hide an exchange URL behind an unnecessary microservice.

## Stored candles

Snapshots were previously held in one process's memory, so a restart lost them
and the workspace could show nothing when the endpoint was unreachable. A small
Python ingester now writes closed candles to PostgreSQL, and the app reads them
back through `GET /api/stored/BTC` (also ETH and SOL). The chart, the replay
cursor and the timeframe comparison are unchanged: a stored market is just
another source in the selector, listed under **Stored candles**.

```sh
# Database, ingester and app together. The named volume keeps the candles.
docker compose up --build

# One pass against the live endpoint, into an existing database.
DATABASE_URL=postgresql://... python -m ingest.ingest --symbols BTC --intervals 1h,4h

# Offline: load the recorded payload instead of calling the endpoint.
DATABASE_URL=postgresql://... python -m ingest.ingest \
  --fixture ingest/fixtures/public-candles.json --now 1788220800000 --symbols BTC --intervals 1h
```

The ingester reads the same documented
[candleSnapshot endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
the browser uses, and applies the same boundary rules in `ingest/candles.py`:
a still-forming candle, a candle that does not span its interval, a non-numeric
price and inconsistent OHLC bounds are all refused before any write. Rows
sharing an opening timestamp with different values are treated as a conflict,
not a duplicate, and reject the whole response.

`(symbol, interval, open_time)` is the primary key, so re-reading the same
window cannot create a second row. The upsert suppresses no-op updates, which
means each pass reports how many candles were inserted, updated and left
unchanged; a corrected candle updates in place instead of appearing twice.
Every attempt, including a failure, is recorded in `ingest_runs` with its own
`fetch_ms` and `write_ms`, measured around the fetch and write calls. Reads
report `Server-Timing: query;dur=` for the handler.

Those numbers are wall-clock measurements between explicit start and end points
in one process. They are not throughput, database server time, network time or
exchange-to-screen latency, and no synchronized clocks are involved.

Limits: closed candles only, so this is a persisted snapshot history and not a
tick feed. One ingester process, no retention, partitioning or backfill policy,
and reads are bounded to 300 bars per interval. An empty store answers 404 with
an instruction rather than an empty chart, and a database that is unreachable
answers 503 rather than silently falling back to the live endpoint. The
duplicate and restart behaviour is checked against a real PostgreSQL server in
CI, using the recorded payload; the counts describe one statement's view, not
concurrent ingesters.

## A reproducible investigation

Choose recorded Gold, move the replay cursor back, then enable timeframe
comparison. Move forward and observe which complete higher-timeframe candles
become available. Export the prefix and compare its final timestamp with the
cursor. This investigates a recorded sequence without hindsight from future
candles; it is not a profitable strategy or a validated trading signal.

Public snapshots retain validated intervals when another request fails. Missing
intervals are labeled and disabled; the chart selects an available interval
instead of showing it under the failed interval's name. Refresh retries all
intervals. Tests cover HTTP failures, malformed data, total outages and partial
timeouts with synthetic responses. No uptime, customer-adoption or operational
performance claim is made. Code is published for inspection; no additional
reuse license is granted. Third-party licenses and chart attribution remain.
