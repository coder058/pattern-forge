"""Regenerate the recorded candle payloads used by tests and continuous integration.

The values are synthetic and deterministic. Tests must not depend on the live
endpoint, so the fixture stands in for it, including the two cases that matter
for persistence: a candle that is still forming, and an exact duplicate.

    python -m ingest.fixtures.build_fixture
"""
import datetime
import json
from pathlib import Path

HOUR_MS = 3_600_000
# The fixture is validated against this fixed instant, so "closed" never drifts.
NOW_MS = int(datetime.datetime(2026, 9, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000)
OUTPUT = Path(__file__).with_name("public-candles.json")


def bar(open_time, interval_ms, seed, symbol, interval):
    opening = 60_000 + seed * 12.5
    closing = opening + (7.5 if seed % 3 else -9.25)
    return {
        "t": open_time,
        "T": open_time + interval_ms - 1,
        "o": opening,
        "h": max(opening, closing) + 4.5,
        "l": min(opening, closing) - 3.25,
        "c": closing,
        "v": 10.0 + seed,
        "s": symbol,
        "i": interval,
        "n": 5,
    }


def series(interval_ms, count, symbol, interval):
    start = NOW_MS - interval_ms * count
    return [bar(start + index * interval_ms, interval_ms, index, symbol, interval) for index in range(count)]


def build():
    btc_hourly = series(HOUR_MS, 48, "BTC", "1h")
    closed_unique = len(btc_hourly)
    # Still forming: its inclusive close is not before NOW_MS, so it must be dropped.
    btc_hourly.append(bar(NOW_MS, HOUR_MS, 99, "BTC", "1h"))
    # An exact repeat of a closed candle: one stored row, not two.
    btc_hourly.append(dict(btc_hourly[5]))
    fixture = {
        "BTC": {"1h": btc_hourly, "4h": series(HOUR_MS * 4, 12, "BTC", "4h")},
        "ETH": {"1h": series(HOUR_MS, 24, "ETH", "1h")},
    }
    # Written with newline="\n" so the committed file is byte-identical whether
    # it is regenerated on Windows or on the Linux CI runner.
    with OUTPUT.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(fixture, indent=1) + "\n")
    return {"now_ms": NOW_MS, "btc_1h_payload": len(btc_hourly), "btc_1h_closed_unique": closed_unique}


if __name__ == "__main__":
    print(json.dumps(build(), indent=1))
