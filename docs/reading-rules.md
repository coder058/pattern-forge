# Reading rules: reference, implementation and limits

Reference inspected: John J. Murphy, *Technical Analysis of the Financial Markets* (1999).
The local reference PDF is not distributed with this repository. Its contents and relevant candle
pages were inspected; not every chapter has been checked against every formula below.

| Reading | Reference / verification | Actual implementation | Check / limitation |
| --- | --- | --- | --- |
| Murphy context | Contents: trend chapter 4, moving averages chapter 9, oscillators chapter 10 | Last closed price/EMA ordering, Bollinger location and Wilder RSI; an application-defined synthesis | `market-analysis.test.mjs`: last-bar context, selected periods, warm-up. Do not attribute this exact decision sequence to the book. |
| Engulfing shape | Chapter 12; printed p.309 / reference PDF p.354 lists a two-candle pattern | Opposite body directions; current body contains prior body, inclusive of equal boundaries; strictly adjacent closed bars | No prior-trend filter, future confirmation or predictive claim. Equality behavior is our explicit implementation choice. |
| Doji | Candle concepts, not a verified numerical textbook threshold | Body / total range ≤ 0.1 for nonzero range | `PATTERN_RULES`: UNCALIBRATED GUESS. A shape, not a trade. |
| Hammer / shooting-star shape | Candle concepts; context matters | Long wick ≥ 2× body; opposite wick ≤ body; nonzero body | `PATTERN_RULES`: UNCALIBRATED GUESS. No trend-conditioned reversal classification. |
| Confirmed pivots | Exploratory geometry, not a calibrated Murphy strategy | A pivot requires later confirming bars | `pivotWing` is an UNCALIBRATED GUESS. Replay tests forbid early visibility. |

Printed p.306 / reference PDF p.351 discusses computer detection and context/filtering. It does not
validate this application's thresholds. Nison fidelity is not claimed. The repository README links
indicator definitions; numerical mechanics are checked independently with synthetic inputs.

## Presentation contract

One selected reading, a short explanation beside the plot, timestamped matches and optional supporting
indicators. A latest historical match is not necessarily the last candle. No match must remain an honest
empty state. Manual drawing lives under Inspect tools and is never required to understand the reading.

The closed-candle engine never infers an hourly candle's intrahour path from its final OHLC.
`formingFourHour` separately assembles contiguous, already-closed hourly observations into an amber
4h preview. Its engulfing shape is provisional; it may disappear. Missing hours suppress the preview,
and a complete boundary returns to the closed series. It never enters confirmed indicators or exports.
`tests/forming.test.mjs` checks those boundaries and prefix invariance with SYNTHETIC inputs.
