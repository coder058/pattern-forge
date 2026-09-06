"""Retry behaviour and attempt recording.

These tests cover control flow with a stub connection. They do not prove the SQL
is correct: that is what the PostgreSQL integration job in continuous
integration checks against a real server.
"""
import io
import json
import unittest
import urllib.error
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from ingest import ingest as ingest_module
from ingest.ingest import fetch_snapshot, ingest_pair

NOW_MS = 1_788_220_800_000
FIXTURE_PATH = Path(ingest_module.__file__).parent / "fixtures/public-candles.json"


@contextmanager
def _reply(payload):
    yield io.BytesIO(json.dumps(payload).encode("utf-8"))


class StubCursor:
    def __init__(self, log):
        self.log = log

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, statement, parameters=None):
        self.log.append((statement.strip().split()[0].upper(), parameters))

    def fetchall(self):
        return []

    def fetchone(self):
        return (1,)


class StubConnection:
    """Records the statements and transaction calls the ingester makes."""

    def __init__(self):
        self.log = []
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return StubCursor(self.log)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def recorded_run(self):
        for name, parameters in self.log:
            if name == "INSERT" and isinstance(parameters, dict) and "started_at" in parameters:
                return parameters
        return None


class FetchSnapshot(unittest.TestCase):
    def test_a_server_error_is_retried_and_can_then_succeed(self):
        attempts = []

        def opener(request, timeout=None):
            attempts.append(request.full_url)
            if len(attempts) < 3:
                raise urllib.error.HTTPError(request.full_url, 503, "busy", {}, None)
            return _reply([{"t": 1}])

        with patch.object(ingest_module.time, "sleep") as sleep:
            payload = fetch_snapshot("BTC", "1h", NOW_MS, opener)
        self.assertEqual(payload, [{"t": 1}])
        self.assertEqual(len(attempts), 3)
        self.assertEqual(sleep.call_count, 2)

    def test_a_dropped_connection_is_retried(self):
        attempts = []

        def opener(request, timeout=None):
            attempts.append(1)
            if len(attempts) < 2:
                raise urllib.error.URLError(ConnectionResetError("reset by peer"))
            return _reply([])

        with patch.object(ingest_module.time, "sleep"):
            self.assertEqual(fetch_snapshot("BTC", "1h", NOW_MS, opener), [])
        self.assertEqual(len(attempts), 2)

    def test_a_request_error_is_not_retried(self):
        attempts = []

        def opener(request, timeout=None):
            attempts.append(1)
            raise urllib.error.HTTPError(request.full_url, 422, "bad request", {}, None)

        with patch.object(ingest_module.time, "sleep"):
            with self.assertRaises(urllib.error.HTTPError):
                fetch_snapshot("BTC", "1h", NOW_MS, opener)
        self.assertEqual(len(attempts), 1)

    def test_the_retry_budget_is_bounded(self):
        def opener(request, timeout=None):
            raise urllib.error.URLError("refused")

        with patch.object(ingest_module.time, "sleep"):
            with self.assertRaises(RuntimeError):
                fetch_snapshot("BTC", "1h", NOW_MS, opener)

    def test_the_request_asks_for_the_selected_market_and_interval(self):
        captured = {}

        def opener(request, timeout=None):
            captured.update(json.loads(request.data.decode("utf-8")))
            return _reply([])

        fetch_snapshot("ETH", "4h", NOW_MS, opener)
        self.assertEqual(captured["type"], "candleSnapshot")
        self.assertEqual(captured["req"]["coin"], "ETH")
        self.assertEqual(captured["req"]["interval"], "4h")
        self.assertEqual(captured["req"]["endTime"], NOW_MS)


class IngestPair(unittest.TestCase):
    def test_a_missing_fixture_pair_is_recorded_as_a_failed_attempt(self):
        connection = StubConnection()
        result = ingest_pair(connection, "BTC", "1d", NOW_MS, fixture={"BTC": {"1h": []}})
        self.assertIn("CandleError", result["error"])
        self.assertEqual(connection.rollbacks, 1)
        run = connection.recorded_run()
        self.assertIsNotNone(run)
        self.assertEqual(run["rows_seen"], 0)
        self.assertIn("CandleError", run["error"])

    def test_a_successful_pass_records_timings_and_counts(self):
        connection = StubConnection()
        fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        result = ingest_pair(connection, "BTC", "1h", NOW_MS, fixture=fixture)
        self.assertIsNone(result["error"])
        self.assertEqual(result["source"], "fixture")
        self.assertIsInstance(result["fetch_ms"], int)
        self.assertIsInstance(result["write_ms"], int)
        run = connection.recorded_run()
        self.assertEqual(run["rows_seen"], 48)


if __name__ == "__main__":
    unittest.main()
