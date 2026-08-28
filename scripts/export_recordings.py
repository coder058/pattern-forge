"""Build public OHLC-only archives from the owner's downloaded market recordings.

No ledgers, accounts, model outputs or credentials are included. Raw inputs stay
outside the public project. The final recorded bar is omitted conservatively.
"""
import argparse
import hashlib
import json
from pathlib import Path

import pandas as pd

# SOURCE: instrument mapping in metals_paper README and venue catalogue.
MARKETS = {
    'XAUUSD': ('GOLD-USD', 'Gold', 'Metals'),
    'XAGUSD': ('SILVER-USD', 'Silver', 'Metals'),
    'WTIOILUSD': ('WTIOIL-USD', 'WTI Oil', 'Energy'),
    'SP500USD': ('SP500-USD', 'S&P 500', 'Indices'),
    'NAS100USD': ('NAS100-USD', 'Nasdaq 100', 'Indices'),
    'BTCUSD': ('BTC-USD', 'Bitcoin', 'Crypto archives'),
    'ETHUSD': ('ETH-USD', 'Ethereum', 'Crypto archives'),
    'SOLUSD': ('SOL-USD', 'Solana', 'Crypto archives'),
    'HYPEUSD': ('HYPE-USD', 'HYPE', 'Crypto archives'),
    'SPCXUSD': ('SPCX-USD', 'SPCX contract', 'Other contracts'),
}
# SOURCE: one-hour native source interval, in milliseconds.
HOUR_MS = 3_600_000


def export(source: Path, target: Path):
    target.mkdir(parents=True, exist_ok=True)
    catalog = []
    for key, (symbol, label, group) in MARKETS.items():
        path = source / f'{key}.parquet'
        frame = pd.read_parquet(path).sort_values('timestamp')
        times = pd.to_datetime(frame['timestamp'], utc=True)
        # SOURCE: last bar's opening proves elapsed earlier intervals only.
        # The final row might have been captured while still forming.
        cutoff = int(times.max().timestamp() * 1000)
        rows = []
        for row in frame.to_dict('records'):
            t = int(pd.Timestamp(row['timestamp']).timestamp() * 1000)
            if t + HOUR_MS > cutoff:
                continue
            values = [float(row[k]) for k in ('open', 'high', 'low', 'close', 'volume')]
            if not all(pd.notna(v) and abs(v) != float('inf') for v in values):
                raise ValueError(f'{key}: nonfinite values')
            o, h, l, c, v = values
            if l <= 0 or h < max(o, c, l) or l > min(o, c) or v < 0:
                raise ValueError(f'{key}: invalid OHLC')
            rows.append(dict(t=t, closeTime=t+HOUR_MS, o=o, h=h, l=l, c=c, v=v, closed=True))
        if not rows or len({r['t'] for r in rows}) != len(rows):
            raise ValueError(f'{key}: empty or duplicate input')
        gaps = sum(b['t'] != a['closeTime'] for a, b in zip(rows, rows[1:]))
        meta = dict(id=f'recorded-{key}', symbol=symbol, label=label, group=group,
                    kind='recording', venue='Polymarket Perps', interval='1h',
                    source='Owner market recordings from Google Cloud Storage',
                    sourceFile=f'{key}.parquet', sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                    first=rows[0]['t'], last=rows[-1]['closeTime'], asOf=cutoff,
                    count=len(rows), gaps=gaps, finalBarOmitted=True,
                    note='Historical perpetual-contract candles, not spot or cash-index quotes. Missing hours are not filled.',
                    path=f'/recordings/{key}.json')
        document = dict(metadata=meta, candles=rows)
        (target / f'{key}.json').write_text(json.dumps(document, allow_nan=False, separators=(',', ':')), encoding='utf-8')
        catalog.append(meta)
        print(f'{symbol}: {len(rows)} closed hourly candles, {gaps} gaps, through {pd.to_datetime(meta["last"], unit="ms", utc=True)}')
    (target / 'catalog.json').write_text(json.dumps(catalog, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('target', type=Path)
    args = parser.parse_args()
    export(args.source, args.target)
