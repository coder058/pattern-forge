"""Fetch closed candles from one documented public endpoint and persist them.

SOURCE: Hyperliquid candleSnapshot, the same endpoint the browser already uses:
https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint

Run once, or with --every to keep running. Every attempt is recorded, including
failures, so a quiet ingester cannot look like a successful one.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import psycopg

from .candles import INTERVAL_MS, CandleError, closed_candles
from .store import apply_schema, read_recent, record_run, upsert_candles

ENDPOINT = "https://api.hyperliquid.xyz/info"
# SOURCE: the markets already offered by the application's public selector.
SYMBOLS = ("BTC", "ETH", "SOL")
# GUESS: UNCALIBRATED GUESS — request window in bars, matching the existing
# display bound in app/publicSnapshot.ts. Not a trading lookback.
BARS = 300
# GUESS: UNCALIBRATED GUESS — bounded retry budget and waits for a restarting
# database or a refused upstream connection. Not a measured availability figure.
ATTEMPTS = 4
BACKOFF_SECONDS = 2.0
TIMEOUT_SECONDS = 15.0


def _milliseconds(started):
    return int(round((time.perf_counter() - started) * 1000))


def fetch_snapshot(symbol, interval, now_ms, opener=urllib.request.urlopen):
    """POST one candleSnapshot request, retrying a refused or failing upstream.

    Retries cover connection resets and 5xx replies. A 4xx reply is a request
    problem and is not retried.
    """
    body = json.dumps({
        "type": "candleSnapshot",
        "req": {
            "coin": symbol,
            "interval": interval,
            "startTime": now_ms - INTERVAL_MS[interval] * BARS,
            "endTime": now_ms,
        },
    }).encode("utf-8")
    last_error = None
    for attempt in range(ATTEMPTS):
        request = urllib.request.Request(
            ENDPOINT, data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with opener(request, timeout=TIMEOUT_SECONDS) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code < 500:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as error:
            last_error = error
        if attempt + 1 < ATTEMPTS:
            time.sleep(BACKOFF_SECONDS * (attempt + 1))
    raise RuntimeError(f"The candle endpoint did not answer after {ATTEMPTS} attempts: {last_error}")


def connect(dsn, attempts=ATTEMPTS):
    """Open a connection, waiting for a database that is still starting up."""
    last_error = None
    for attempt in range(attempts):
        try:
            return psycopg.connect(dsn, connect_timeout=int(TIMEOUT_SECONDS))
        except psycopg.OperationalError as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(BACKOFF_SECONDS * (attempt + 1))
    raise RuntimeError(f"The database did not accept a connection after {attempts} attempts: {last_error}")


def load_fixture(path):
    """Read recorded upstream payloads keyed by symbol and interval."""
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def ingest_pair(connection, symbol, interval, now_ms, fixture=None, opener=urllib.request.urlopen):
    """Fetch, validate and persist one market and interval; always record the attempt."""
    started_at = datetime.now(timezone.utc)
    source = "fixture" if fixture is not None else ENDPOINT
    fetch_ms = write_ms = None
    counts = {"seen": 0, "inserted": 0, "updated": 0, "unchanged": 0}
    error = None
    try:
        fetch_started = time.perf_counter()
        if fixture is not None:
            payload = fixture.get(symbol, {}).get(interval)
            if payload is None:
                raise CandleError(f"The fixture has no {symbol} {interval} payload.")
        else:
            payload = fetch_snapshot(symbol, interval, now_ms, opener)
        fetch_ms = _milliseconds(fetch_started)
        rows = closed_candles(payload, now_ms, interval)
        write_started = time.perf_counter()
        counts = upsert_candles(connection, symbol, interval, rows)
        connection.commit()
        write_ms = _milliseconds(write_started)
    except Exception as failure:  # recorded, then reported to the caller
        connection.rollback()
        error = f"{type(failure).__name__}: {failure}"
    record_run(
        connection, symbol=symbol, interval=interval, source=source,
        started_at=started_at, finished_at=datetime.now(timezone.utc),
        fetch_ms=fetch_ms, write_ms=write_ms, rows_seen=counts["seen"],
        rows_inserted=counts["inserted"], rows_updated=counts["updated"],
        rows_unchanged=counts["unchanged"], error=error)
    connection.commit()
    return {
        "symbol": symbol, "interval": interval, "source": source,
        "fetch_ms": fetch_ms, "write_ms": write_ms, **counts, "error": error,
    }


def run_once(connection, symbols, intervals, now_ms, fixture=None, opener=urllib.request.urlopen):
    results = []
    for symbol in symbols:
        for interval in intervals:
            result = ingest_pair(connection, symbol, interval, now_ms, fixture, opener)
            results.append(result)
            print(json.dumps(result), flush=True)
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"),
                        help="PostgreSQL connection string; defaults to DATABASE_URL")
    parser.add_argument("--symbols", default=",".join(SYMBOLS),
                        help=f"comma-separated markets from {', '.join(SYMBOLS)}")
    parser.add_argument("--intervals", default="1h,4h,1d",
                        help=f"comma-separated intervals from {', '.join(INTERVAL_MS)}")
    parser.add_argument("--fixture", help="read recorded payloads instead of calling the endpoint")
    parser.add_argument("--now", type=int, help="treat this epoch-millisecond value as now")
    parser.add_argument("--every", type=float,
                        help="keep running, waiting this many seconds between passes")
    parser.add_argument("--show-stored", action="store_true",
                        help="after ingesting, print how many candles are stored per pair")
    arguments = parser.parse_args(argv)
    if not arguments.database_url:
        parser.error("set --database-url or DATABASE_URL")
    symbols = [value.strip() for value in arguments.symbols.split(",") if value.strip()]
    intervals = [value.strip() for value in arguments.intervals.split(",") if value.strip()]
    unknown = [value for value in intervals if value not in INTERVAL_MS]
    if unknown:
        parser.error(f"unsupported intervals: {', '.join(unknown)}")
    if arguments.fixture is None and [value for value in symbols if value not in SYMBOLS]:
        parser.error(f"live symbols must come from {', '.join(SYMBOLS)}")

    fixture = load_fixture(arguments.fixture) if arguments.fixture else None
    connection = connect(arguments.database_url)
    apply_schema(connection)
    failures = 0
    try:
        while True:
            now_ms = arguments.now if arguments.now is not None else int(time.time() * 1000)
            results = run_once(connection, symbols, intervals, now_ms, fixture)
            failures = sum(1 for result in results if result["error"])
            if arguments.show_stored:
                for symbol in symbols:
                    for interval in intervals:
                        stored = read_recent(connection, symbol, interval, BARS)
                        print(json.dumps({"symbol": symbol, "interval": interval,
                                          "stored": len(stored)}), flush=True)
            if not arguments.every:
                break
            time.sleep(arguments.every)
    finally:
        connection.close()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
