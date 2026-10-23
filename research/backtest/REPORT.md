# Do the marked candle shapes make money after costs? No.

**23 October 2026 · preregistered · one holdout run · [protocol](PREREGISTRATION.md) ·
[discovery results](discovery.json) · [holdout results](holdout.json)**

## Answer

None of the three preregistered candidates survived. All three were profitable in the
discovery window and lost money on the held-out data. The discovery "edge" was the market
falling, not the candle shape.

| Candidate (frozen before the holdout) | Discovery: trades · net mean | Holdout: trades · net mean | Markets positive | Random-entry p | Result |
|---|---|---|---|---|---|
| 4h · bearish engulfing · hold 12 | 103 · **+95.3 bps** (t 2.73) | 56 · **−95.0 bps** (t −1.93) | 2 / 10 | 0.547 | Fail |
| 1h · bearish engulfing at upper band · hold 4 | 65 · **+33.0 bps** (t 2.52) | 14 · **−125.2 bps** | 3 / 9 | 0.987 | Fail |
| 1h · shooting star at upper band · hold 4 | 121 · **+18.2 bps** (t 1.52) | 48 · **−50.3 bps** (t −2.89) | 2 / 10 | 0.931 | Fail |

Net = after 16 bps round-trip costs. Pass needed: positive net mean, random-entry
p < 0.0167, positive in at least half the markets, at least 20 trades.

## Why it looked good, and why it was not

1. **Every winner was a short.** In the discovery window eight of ten markets fell
   (Gold −12%, WTI −21%, SPCX −35%, HYPE −20%). Any short held for a few hours earned money.
2. **The random-entry control explains it.** In the holdout, random shorts with the same exit
   rule lost a median −87.7 bps (4h, hold 12). The pattern lost −95.0 bps — no better than
   random entries in the same direction. Its p-value against random entries is 0.55.
3. **Multiple testing.** 228 configurations had enough trades. Under pure noise the best of
   228 t-statistics is expected to be around 2.5–3; the best discovery t was 2.73.

## Transfer check (exploratory context, not a pass criterion)

| Candidate | EUR/USD 1h (1 bp/side) | GOOG daily (5 bps/side) |
|---|---|---|
| 4h bearish engulfing · hold 12 | 52 trades · −11.3 bps · p 0.26 | 65 · −188.3 bps · p 0.65 |
| 1h bearish engulfing at band · hold 4 | 41 · +2.1 bps · p 0.04 | 9 · +183.2 bps · p 0.06 |
| 1h shooting star at band · hold 4 | 50 · −0.3 bps · p 0.14 | 11 · −106.6 bps · p 0.74 |

The one positive EUR/USD row (+2.1 bps on 41 trades) is not significant at the corrected
threshold and is smaller than a realistic retail spread.

## What changed during the study

- **Amendment 1 (before the holdout):** bad prints in the recordings — Silver's first candle
  at Gold's price, isolated wicks to round numbers (BTC 126,570; ETH 100; Silver 40.0) — made
  Silver look −98.8% in discovery. A tested rule now turns 14 of ~20,000 candles into gaps.
  Discovery was re-run; the first run is kept in git history (`18dab9d`).
- Nothing was changed after the holdout ran.

## Limits

About three months of hourly data per market, mostly one regime per window, assumed costs,
no order-book or funding data, nothing traded live. A failure here does not prove that no
candle-based rule can work anywhere; it shows that these marks, as defined, do not give a
tradable edge on this data — and that a convincing backtest can come from the market's drift.

## What the product does with this

The app's **Backtest** tab lets anyone run the same engine on any market and replay
position, always next to the random-entry baseline, so a shape's apparent profit is shown
against what random entries in the same direction would have made.
