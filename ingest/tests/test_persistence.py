"""Integration checks against a real PostgreSQL server.

Skipped unless DATABASE_URL is set, so the unit suite stays offline. These are
the tests that prove the SQL, not just the control flow: a repeated candle must
not create a second row, a changed candle must update in place, and a new
connection must still see what an earlier process wrote.
"""
import copy
import json
import os
import unittest
from pathlib import Path

from ingest.ingest import run_once
from ingest.store import apply_schema, read_recent

DATABASE_URL = os.environ.get("DATABASE_URL")
FIXTURE_PATH = Path(__file__).parents[1] / "fixtures/public-candles.json"
NOW_MS = 1_788_220_800_000
# The recorded BTC hourly payload holds 50 rows: 48 closed and unique, one still
# forming, and one exact repeat. See ingest/fixtures/build_fixture.py.
BTC_HOURLY_CLOSED = 48


@unittest.skipUnless(DATABASE_URL, "set DATABASE_URL to run the persistence checks")
class Persistence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg

        cls.psycopg = psycopg
        cls.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    def connect(self):
        return self.psycopg.connect(DATABASE_URL)

    def setUp(self):
        self.connection = self.connect()
        apply_schema(self.connection)
        with self.connection.cursor() as cursor:
            cursor.execute("TRUNCATE candles, ingest_runs")
        self.connection.commit()
        self.addCleanup(self.connection.close)

    def stored_count(self, connection, symbol="BTC", interval="1h"):
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM candles WHERE symbol = %s AND interval = %s",
                           (symbol, interval))
            return cursor.fetchone()[0]

    def ingest(self, fixture=None):
        return {
            (result["symbol"], result["interval"]): result
            for result in run_once(self.connection, ["BTC"], ["1h"], NOW_MS,
                                   fixture if fixture is not None else self.fixture)
        }

    def test_a_first_pass_stores_only_closed_unique_candles(self):
        result = self.ingest()[("BTC", "1h")]
        self.assertIsNone(result["error"])
        self.assertEqual(result["seen"], BTC_HOURLY_CLOSED)
        self.assertEqual(result["inserted"], BTC_HOURLY_CLOSED)
        self.assertEqual((result["updated"], result["unchanged"]), (0, 0))
        self.assertEqual(self.stored_count(self.connection), BTC_HOURLY_CLOSED)

    def test_repeating_the_same_payload_changes_nothing(self):
        self.ingest()
        repeated = self.ingest()[("BTC", "1h")]
        self.assertEqual(repeated["inserted"], 0)
        self.assertEqual(repeated["updated"], 0)
        self.assertEqual(repeated["unchanged"], BTC_HOURLY_CLOSED)
        self.assertEqual(self.stored_count(self.connection), BTC_HOURLY_CLOSED)

    def test_a_corrected_candle_updates_in_place(self):
        self.ingest()
        corrected = copy.deepcopy(self.fixture)
        target = corrected["BTC"]["1h"][10]
        target["c"] = target["h"]
        result = self.ingest(corrected)[("BTC", "1h")]
        self.assertEqual(result["inserted"], 0)
        self.assertEqual(result["updated"], 1)
        self.assertEqual(result["unchanged"], BTC_HOURLY_CLOSED - 1)
        self.assertEqual(self.stored_count(self.connection), BTC_HOURLY_CLOSED)
        rows = read_recent(self.connection, "BTC", "1h", BTC_HOURLY_CLOSED)
        self.assertEqual(rows[10]["close"], target["h"])

    def test_every_attempt_is_recorded_with_its_own_timings(self):
        self.ingest()
        self.ingest({"BTC": {}})
        with self.connection.cursor() as cursor:
            cursor.execute("""
                SELECT source, fetch_ms, write_ms, rows_inserted, error
                  FROM ingest_runs ORDER BY id
            """)
            runs = cursor.fetchall()
        self.assertEqual(len(runs), 2)
        succeeded, failed = runs
        self.assertEqual(succeeded[0], "fixture")
        self.assertIsNotNone(succeeded[1])
        self.assertIsNotNone(succeeded[2])
        self.assertEqual(succeeded[3], BTC_HOURLY_CLOSED)
        self.assertIsNone(succeeded[4])
        self.assertIsNone(failed[2])
        self.assertIn("CandleError", failed[4])

    def test_a_new_connection_reads_what_an_earlier_process_wrote(self):
        self.ingest()
        self.connection.close()
        # A separate connection stands in for a restarted reader: nothing is held
        # in the writer's memory, so this can only come from the database.
        with self.connect() as reader:
            rows = read_recent(reader, "BTC", "1h", 500)
            self.assertEqual(len(rows), BTC_HOURLY_CLOSED)
            openings = [row["open_time"] for row in rows]
            self.assertEqual(openings, sorted(openings))
            self.assertTrue(all(row["close_time"] <= NOW_MS for row in rows))

    def test_the_read_bound_limits_rows_without_reordering_them(self):
        self.ingest()
        rows = read_recent(self.connection, "BTC", "1h", 5)
        self.assertEqual(len(rows), 5)
        openings = [row["open_time"] for row in rows]
        self.assertEqual(openings, sorted(openings))
        # A bounded read returns the newest window, still oldest first.
        everything = [row["open_time"] for row in read_recent(self.connection, "BTC", "1h", 500)]
        self.assertEqual(openings, everything[-5:])


if __name__ == "__main__":
    unittest.main()
