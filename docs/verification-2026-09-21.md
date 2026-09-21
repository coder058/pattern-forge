# Pattern Forge — local delivery verification

## Implemented in this working tree

- `/about`: step-by-step usage and four tables covering data paths, dependencies, the actual
  `candles` / `ingest_runs` schema, and engineering decisions with verification links.
- The public-demo/local-database boundary is explicit. The guide does not pretend the candle upsert
  preserves old versions or that run logging and candle writes share a transaction.
- Selecting a candle shape automatically focuses the latest available match. Stale selections cannot
  point beyond replay. No-match states are retained; matching equal engulfing-body boundaries is documented.
- Murphy readings preserve optional indicators and the lower pane. Supporting indicators require an
  explicit action. Draw is under Inspect tools; repeated candle evidence is collapsed by default.
- Optional forming 4h preview for hourly recordings, limited to engulfing geometry. Amber provisional
  OHLC uses already-closed contiguous hourly input only. Missing hours suppress it; complete boundaries
  use the confirmed series. It never enters closed indicators or exported candles.
- Crosshair values resolve against current replay input rather than retaining a stale hovered OHLC.
- The walkthrough tables retain readable column widths and scroll inside labelled, focusable regions
  on mobile; the page itself does not overflow horizontally.

## Executed

- `npm test`: 54 passing tests.
- `npm run build`: successful production build and TypeScript checks, including `/about`.
- `npm run test:browser`: six passing groups, including desktop/narrow/mobile, source outage,
  synthetic provisional appearance/disappearance/closure, and the committed GOLD archive plus export.
- `python -m unittest discover -s ingest/tests -t .`: 24 discovered, 18 passed and six PostgreSQL
  tests skipped because no test database was configured. No new PostgreSQL verification is claimed.
- `git diff --check`: no whitespace errors; Git emitted line-ending conversion notices.
- Screenshots were inspected for desktop and mobile chart/guide layout. Generated images are ignored
  local QA artifacts under `test-results/astra-v3/`, not portfolio market-performance evidence.

## Reproducible recorded example

Select recorded GOLD-USD, 4h, Candlestick patterns, Bullish engulfing, then Preview forming 4h.
The browser test derives a real match from the committed archive: replay position 131, through
2026-05-14 13:00 UTC. The partial candle starts at 12:00 UTC; it has one closed hourly observation.
The test compares the exported candles with `aggregateBars` at precisely that cutoff and verifies
that the provisional body is absent from the export. This is an archived perpetual-contract example,
not a current gold spot price or proof of predictive performance.

## Publication boundary

The 54 Node tests, production build and six browser groups were rerun successfully before publishing
this source. Vercel CLI reported `Logged out`; a source push alone is not proof of a successful
production deployment. Verify the deployment status and public `/about` route before describing
the public URL as updated. Local preview uses port 3018.

No base-hour intrabar reconstruction, live partial-candle feed, forming Murphy indicators, calibrated
strategy, profitability, production latency, database deployment or current-provider availability
certification was added. Energy Monitor and Relay deployment changes are separate work.
