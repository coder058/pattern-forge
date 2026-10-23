# Preregistration — do the marked candle shapes make money after costs?

Written on 23 October 2026, **before** any backtest of these strategies was run.
Committed to git before the discovery script's first run; the holdout script must not
run until discovery results and `candidates.json` are committed.

## Question

Pattern Forge marks bullish/bearish engulfing, hammer and shooting-star shapes. If a
trader had acted on those marks — with realistic costs and no hindsight — would any
simple, fixed rule have made money on data it was not tuned on?

## Data

- The ten committed hourly recordings in `public/recordings/` (Polymarket Perps
  contracts, about 1,000–2,500 hourly candles each, May–August 2026). 1h and complete
  4h aggregates (`aggregateBars`, missing hours never filled).
- **Split, per market, fixed in code:** the earlier 60% of hourly candles is the
  *discovery* window; the later 40% is the *holdout*. The same time boundary applies to
  4h candles. A discovery trade must exit before the boundary.
- **External check (after the holdout):** the EUR/USD hourly and GOOG daily fixtures
  published with backtesting.py (commit `ca2e2611621e472542ba90f7243a1fa06a7d7108`),
  downloaded at run time and verified by SHA-256. Different assets and venues; they are a
  transfer test, not a second holdout of the same markets.

## Rules (implemented in `app/backtest.ts`, tested in `tests/backtest.test.mjs`)

- Signal known at the candle's close; entry at the next candle's open.
- Stop/target checked against high/low; if both are touched in one candle the stop fills
  first; a candle opening beyond a level fills at its open.
- No signal on, or right after, a flat candle (high = low); no trade across a data gap.
- One position at a time per market.
- Costs: 5 bps fee + 3 bps slippage per side (16 bps round trip) for the recordings.
  External: EUR/USD 1 bp per side in total; GOOG 5 bps per side in total.

## Grid (360 configurations)

Timeframe {1h, 4h} × signal {4 shapes, EMA 20/50 cross} × mode {follow, fade} ×
filter {none, trend (close > EMA20 > EMA50 for longs, reverse for shorts), extreme
(long only if the low reached the lower Bollinger band; short only if the high reached
the upper band)} × exit {hold 1, hold 4, hold 12, ATR 1/1.5 max 24, ATR 1/2 max 24,
ATR 1.5/3 max 48}.

## Selection (discovery window only)

Pool trades across all ten markets. Rank configurations with at least 40 trades by the
t-statistic of the mean net return per trade. **Candidates = the top three with a
positive net mean.** If none is positive, the answer is "no candidate" and the holdout
is still run on the top three by t-statistic, reported as a negative result.

## Pass criteria (holdout window, run once)

A candidate passes only if **all** hold:

1. pooled mean net return per trade > 0 after the 16 bps round trip;
2. one-sided random-entry p-value < 0.05 / 3 = 0.0167 (1,000 random entries with the
   same trade count, long/short mix and exit rule on tradable holdout candles; seed 7);
3. positive mean in at least half of the markets where it traded;
4. at least 20 holdout trades.

A candidate that passes is reported as "survived one holdout on ~3 months of data",
**not** as a profitable strategy: the sample is small, costs are assumed, and nothing
was traded live. A candidate that fails is reported as failing, with its numbers.

## What will not be done

- No change to the grid, costs, split or criteria after seeing holdout results.
- No second holdout attempt with a modified rule presented as the same test.
- Any later exploration is labelled exploratory in the report.

## Amendment 1 — 23 October 2026, after discovery, before any holdout run

The first discovery run (commit `18dab9d`, kept in history) used uncleaned recordings.
Checking why Silver's discovery window showed −98.8% revealed bad prints: Silver's first
candle carries Gold's price (4,834.4 vs ~79), and several markets have isolated wicks to
round numbers that revert within the hour (BTC high 126,570; ETH low 100; Silver lows 40.0).
Trades through such candles produce returns no one could have traded.

Change: before any calculation, `dropBadPrints` (in `app/backtest.ts`, tested) removes a
candle if its open, high, low or close lies more than 20% from the median close of up to
three neighbouring candles on each side. Removed candles become gaps. It removes 14 of
about 20,000 hourly candles (BTC 1, ETH 2, SOL 2, SPCX 2, WTI 2, Silver 3). The rule uses
neighbouring candles, so it is a cleaning step for recorded history, not a trading signal.

Discovery is re-run on the cleaned data and candidates are re-selected with the unchanged
rule. Grid, costs, split, selection and pass criteria are unchanged. The holdout window
remains untouched.
