-- SOURCE: a closed candle is identified by its market, interval and opening time,
-- so that pair is the natural primary key and the duplicate guard.
CREATE TABLE IF NOT EXISTS candles (
  symbol      text             NOT NULL,
  interval    text             NOT NULL,
  open_time   bigint           NOT NULL,
  close_time  bigint           NOT NULL,
  "open"      double precision NOT NULL,
  "high"      double precision NOT NULL,
  "low"       double precision NOT NULL,
  "close"     double precision NOT NULL,
  volume      double precision NOT NULL,
  ingested_at timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, interval, open_time)
);

-- SOURCE: the query path reads the most recent candles for one market and
-- interval in opening order, which this index serves directly.
CREATE INDEX IF NOT EXISTS candles_recent
  ON candles (symbol, interval, open_time DESC);

-- Timings recorded here are wall-clock measurements around the fetch and write
-- calls in ingest.py. They are not exchange latency or throughput guarantees.
CREATE TABLE IF NOT EXISTS ingest_runs (
  id             bigserial   PRIMARY KEY,
  symbol         text        NOT NULL,
  interval       text        NOT NULL,
  source         text        NOT NULL,
  started_at     timestamptz NOT NULL,
  finished_at    timestamptz NOT NULL,
  fetch_ms       integer,
  write_ms       integer,
  rows_seen      integer     NOT NULL DEFAULT 0,
  rows_inserted  integer     NOT NULL DEFAULT 0,
  rows_updated   integer     NOT NULL DEFAULT 0,
  rows_unchanged integer     NOT NULL DEFAULT 0,
  error          text
);
