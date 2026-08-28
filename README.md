# Pattern Forge — market workspace

Public site: https://pattern-forge-five.vercel.app/

A chart-first workspace for public Hyperliquid snapshots and existing recorded
Polymarket Perps markets. This is not an order terminal, strategy recommendation,
live account monitor or proof of profitability.

## Interface

- Market search and selector: BTC/ETH/SOL public snapshots; ten recorded markets;
  the original saved BTC case. Only the selected public market is requested.
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
also produces the production build. Deployment uses the existing linked Vercel
project. Keep the raw downloads outside this checkout; public JSON is generated
data, not a hand-edited fixture. Do not run any trading service to test this UI.

## A reproducible investigation

Choose recorded Gold, move the replay cursor back, then enable timeframe
comparison. Move forward and observe which complete higher-timeframe candles
become available. Export the prefix and compare its final timestamp with the
cursor. This investigates a recorded sequence without hindsight from future
candles; it is not a profitable strategy or a validated trading signal.

Public snapshots currently require all requested intervals to succeed; an
upstream interval failure can reject the entire load. This limitation is not
fixed by the indicator tests. No uptime, customer-adoption or operational
performance claim is made. Code is published for inspection; no additional
reuse license is granted. Third-party licenses and chart attribution remain.
