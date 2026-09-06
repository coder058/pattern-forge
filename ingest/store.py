"""PostgreSQL persistence for validated candles.

Storing a candle twice must not create a second row, and re-reading an
unchanged candle must not be reported as new work. Both are decided by the
database in one statement rather than by a prior read in the ingester.
"""
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

# The conflict target is the primary key, so a repeated candle updates in place.
# The WHERE clause suppresses no-op updates, so an unchanged candle returns no
# row at all and is counted as unchanged.
# SOURCE: PostgreSQL exposes xmax = 0 for a row inserted by this statement,
# which is how insert and update are told apart. It is a storage-level detail,
# so the counts below describe this statement only, not the whole table.
UPSERT = """
INSERT INTO candles (symbol, interval, open_time, close_time, "open", "high", "low", "close", volume)
SELECT %(symbol)s, %(interval)s, u.open_time, u.close_time, u."open", u."high", u."low", u."close", u.volume
  FROM unnest(
         %(open_time)s::bigint[], %(close_time)s::bigint[],
         %(open)s::double precision[], %(high)s::double precision[],
         %(low)s::double precision[], %(close)s::double precision[],
         %(volume)s::double precision[]
       ) AS u(open_time, close_time, "open", "high", "low", "close", volume)
    ON CONFLICT (symbol, interval, open_time) DO UPDATE
   SET close_time = EXCLUDED.close_time,
       "open" = EXCLUDED."open", "high" = EXCLUDED."high", "low" = EXCLUDED."low",
       "close" = EXCLUDED."close", volume = EXCLUDED.volume,
       ingested_at = now()
 WHERE (candles.close_time, candles."open", candles."high", candles."low", candles."close", candles.volume)
        IS DISTINCT FROM
       (EXCLUDED.close_time, EXCLUDED."open", EXCLUDED."high", EXCLUDED."low", EXCLUDED."close", EXCLUDED.volume)
 RETURNING (xmax = 0) AS inserted
"""

SELECT_RECENT = """
SELECT open_time, close_time, "open", "high", "low", "close", volume
  FROM candles
 WHERE symbol = %(symbol)s AND interval = %(interval)s
 ORDER BY open_time DESC
 LIMIT %(limit)s
"""

RECORD_RUN = """
INSERT INTO ingest_runs (symbol, interval, source, started_at, finished_at, fetch_ms, write_ms,
                         rows_seen, rows_inserted, rows_updated, rows_unchanged, error)
VALUES (%(symbol)s, %(interval)s, %(source)s, %(started_at)s, %(finished_at)s, %(fetch_ms)s,
        %(write_ms)s, %(rows_seen)s, %(rows_inserted)s, %(rows_updated)s, %(rows_unchanged)s, %(error)s)
RETURNING id
"""


def apply_schema(connection):
    """Create the tables and index if they do not exist. Safe to run repeatedly."""
    with connection.cursor() as cursor:
        cursor.execute(SCHEMA_PATH.read_text(encoding="utf-8"))
    connection.commit()


def upsert_candles(connection, symbol, interval, rows):
    """Persist validated candles and report what actually changed."""
    if not rows:
        return {"seen": 0, "inserted": 0, "updated": 0, "unchanged": 0}
    parameters = {"symbol": symbol, "interval": interval}
    for field in ("open_time", "close_time", "open", "high", "low", "close", "volume"):
        parameters[field] = [row[field] for row in rows]
    with connection.cursor() as cursor:
        cursor.execute(UPSERT, parameters)
        written = [record[0] for record in cursor.fetchall()]
    inserted = sum(1 for flag in written if flag)
    return {
        "seen": len(rows),
        "inserted": inserted,
        "updated": len(written) - inserted,
        "unchanged": len(rows) - len(written),
    }


def read_recent(connection, symbol, interval, limit):
    """Return stored candles in opening order, oldest first."""
    with connection.cursor() as cursor:
        cursor.execute(SELECT_RECENT, {"symbol": symbol, "interval": interval, "limit": limit})
        records = cursor.fetchall()
    fields = ("open_time", "close_time", "open", "high", "low", "close", "volume")
    return [dict(zip(fields, record)) for record in reversed(records)]


def record_run(connection, **run):
    """Store one ingest attempt, including failures, so runs stay auditable."""
    with connection.cursor() as cursor:
        cursor.execute(RECORD_RUN, run)
        return cursor.fetchone()[0]
