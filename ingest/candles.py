"""Closed-candle validation for the ingestion path.

SOURCE: these rules mirror closedPublicCandles in app/publicMarket.ts. The
browser and the ingester read the same upstream shape, so the same boundary
rules apply in both languages. This is a deliberate duplicate, not a shared
library: a candle that the browser would refuse must not reach the database.
"""

# SOURCE: Hyperliquid candleSnapshot interval identifiers and their durations.
INTERVAL_MS = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}


class CandleError(ValueError):
    """A candle response cannot be trusted and must not be persisted."""


def _number(value):
    """Accept a JSON number or a non-empty numeric string, as the upstream sends both."""
    if isinstance(value, bool):
        raise CandleError("Candle contains non-numeric price or volume.")
    if isinstance(value, (int, float)):
        result = float(value)
    elif isinstance(value, str) and value.strip():
        try:
            result = float(value)
        except ValueError:
            raise CandleError("Candle contains non-numeric price or volume.") from None
    else:
        raise CandleError("Candle contains non-numeric price or volume.")
    if result != result or result in (float("inf"), float("-inf")):
        raise CandleError("Candle contains non-numeric price or volume.")
    return result


def _integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def closed_candles(payload, now_ms, interval):
    """Return sorted, provably closed candles, or raise CandleError.

    Candles whose inclusive close is at or after ``now_ms`` are still forming and
    are dropped rather than stored. Rows sharing an opening timestamp with
    different values are a conflict, not a duplicate, and reject the response.
    """
    if interval not in INTERVAL_MS:
        raise CandleError(f"Unsupported interval: {interval}")
    interval_ms = INTERVAL_MS[interval]
    if not isinstance(payload, list):
        raise CandleError("The exchange returned an invalid candle response.")
    by_time = {}
    for item in payload:
        if not isinstance(item, dict):
            raise CandleError("Malformed candle row.")
        open_time, close_inclusive = item.get("t"), item.get("T")
        if not _integer(open_time) or not _integer(close_inclusive):
            raise CandleError("Candle timestamps do not match the requested interval.")
        if open_time < 0 or close_inclusive < open_time:
            raise CandleError("Candle timestamps do not match the requested interval.")
        if close_inclusive + 1 != open_time + interval_ms:
            raise CandleError("Candle timestamps do not match the requested interval.")
        if close_inclusive >= now_ms:
            continue
        opening, high, low, closing, volume = (_number(item.get(key)) for key in ("o", "h", "l", "c", "v"))
        if low <= 0 or high < max(opening, closing, low) or low > min(opening, closing) or volume < 0:
            raise CandleError("Candle OHLC bounds are inconsistent.")
        row = {
            "open_time": open_time,
            "close_time": close_inclusive + 1,
            "open": opening,
            "high": high,
            "low": low,
            "close": closing,
            "volume": volume,
        }
        previous = by_time.get(open_time)
        if previous is not None and previous != row:
            raise CandleError("Conflicting candles share an opening timestamp.")
        by_time[open_time] = row
    if not by_time:
        raise CandleError("No provably closed candles were returned.")
    return [by_time[key] for key in sorted(by_time)]
