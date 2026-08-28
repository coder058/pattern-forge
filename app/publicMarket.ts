/** Read-only candle validation. Never turns forming or malformed bars into evidence. */
export function closedPublicCandles(value: unknown, now: number, intervalMs: number) {
  if (!Array.isArray(value)) throw new Error('The exchange returned an invalid candle response.');
  const byTime = new Map<number, { t: number; closeTime: number; o: number; h: number; l: number; c: number; v: number; closed: boolean }>();
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new Error('Malformed candle row.');
    const { t, T } = item;
    // SOURCE: Hyperliquid candleSnapshot t/T are opening and inclusive closing epoch milliseconds.
    if (!Number.isSafeInteger(t) || !Number.isSafeInteger(T) || t < 0 || T < t || T + 1 !== t + intervalMs)
      throw new Error('Candle timestamps do not match the requested interval.');
    if (T >= now) continue;
    const values = ['o', 'h', 'l', 'c', 'v'].map(key => typeof item[key] === 'number' || (typeof item[key] === 'string' && item[key].trim()) ? Number(item[key]) : NaN);
    if (!values.every(Number.isFinite)) throw new Error('Candle contains non-numeric price or volume.');
    const [o, h, l, c, v] = values;
    if (l <= 0 || h < Math.max(o, c, l) || l > Math.min(o, c) || v < 0) throw new Error('Candle OHLC bounds are inconsistent.');
    const row = { t, closeTime: T + 1, o, h, l, c, v, closed: true };
    const previous = byTime.get(t);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error('Conflicting candles share an opening timestamp.');
    byTime.set(t, row);
  }
  const result = [...byTime.values()].sort((a, b) => a.t - b.t);
  if (!result.length) throw new Error('No provably closed candles were returned.');
  return result;
}
