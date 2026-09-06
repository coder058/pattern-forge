"""Boundary rules for candles entering the database."""
import json
import unittest
from pathlib import Path

from ingest.candles import CandleError, closed_candles

FIXTURE = json.loads((Path(__file__).parents[1] / "fixtures/public-candles.json").read_text(encoding="utf-8"))
NOW_MS = 1_788_220_800_000
HOUR_MS = 3_600_000


def hourly(open_time, **overrides):
    row = {"t": open_time, "T": open_time + HOUR_MS - 1, "o": 100.0, "h": 104.5,
           "l": 96.5, "c": 101.0, "v": 12.0}
    row.update(overrides)
    return row


class ClosedCandles(unittest.TestCase):
    def test_recorded_payload_drops_forming_and_collapses_duplicates(self):
        payload = FIXTURE["BTC"]["1h"]
        rows = closed_candles(payload, NOW_MS, "1h")
        self.assertEqual(len(payload), 50)
        self.assertEqual(len(rows), 48)
        self.assertTrue(all(row["close_time"] <= NOW_MS for row in rows))

    def test_rows_are_sorted_by_opening_time(self):
        rows = closed_candles([hourly(NOW_MS - HOUR_MS * 2), hourly(NOW_MS - HOUR_MS * 5)], NOW_MS, "1h")
        self.assertEqual([row["open_time"] for row in rows],
                         [NOW_MS - HOUR_MS * 5, NOW_MS - HOUR_MS * 2])

    def test_close_time_is_exclusive(self):
        opening = NOW_MS - HOUR_MS * 3
        row = closed_candles([hourly(opening)], NOW_MS, "1h")[0]
        self.assertEqual(row["close_time"], opening + HOUR_MS)

    def test_numeric_strings_are_accepted(self):
        row = closed_candles([hourly(NOW_MS - HOUR_MS, o="100.5", h="104", l="99", c="103", v="7")],
                             NOW_MS, "1h")[0]
        self.assertEqual((row["open"], row["volume"]), (100.5, 7.0))

    def test_conflicting_rows_sharing_an_opening_time_are_rejected(self):
        opening = NOW_MS - HOUR_MS * 4
        with self.assertRaises(CandleError):
            closed_candles([hourly(opening), hourly(opening, c=102.0)], NOW_MS, "1h")

    def test_interval_mismatch_is_rejected(self):
        opening = NOW_MS - HOUR_MS * 4
        with self.assertRaises(CandleError):
            closed_candles([{**hourly(opening), "T": opening + HOUR_MS}], NOW_MS, "1h")

    def test_inconsistent_bounds_are_rejected(self):
        opening = NOW_MS - HOUR_MS * 4
        for overrides in ({"h": 99.0}, {"l": 101.5}, {"l": 0.0}, {"v": -1.0}):
            with self.subTest(overrides=overrides):
                with self.assertRaises(CandleError):
                    closed_candles([hourly(opening, **overrides)], NOW_MS, "1h")

    def test_non_numeric_values_are_rejected(self):
        opening = NOW_MS - HOUR_MS * 4
        for value in (None, True, "", "abc", [], {}):
            with self.subTest(value=value):
                with self.assertRaises(CandleError):
                    closed_candles([hourly(opening, c=value)], NOW_MS, "1h")

    def test_malformed_responses_are_rejected(self):
        for payload in ({"t": 0}, "candles", None, [None], [[]]):
            with self.subTest(payload=payload):
                with self.assertRaises(CandleError):
                    closed_candles(payload, NOW_MS, "1h")

    def test_a_response_with_only_forming_candles_is_rejected(self):
        with self.assertRaises(CandleError):
            closed_candles([hourly(NOW_MS)], NOW_MS, "1h")

    def test_unsupported_interval_is_rejected(self):
        with self.assertRaises(CandleError):
            closed_candles([hourly(NOW_MS - HOUR_MS)], NOW_MS, "3h")


if __name__ == "__main__":
    unittest.main()
