// Tiny candle drawings that show what each shape looks like, for readers who do not
// know the names. Purely illustrative: they mirror the detector rules in marketAnalysis.

type Candle = { o: number; c: number; h: number; l: number };
// Screen coordinates on a 0–20 scale (0 = top): a candle whose close sits above its open
// (smaller y) is an up candle. Bodies are drawn wide so the shape reads at 16–28 px.
const SHAPES: Record<string, Candle[]> = {
  "Bullish engulfing": [{ o: 6, c: 12, h: 4, l: 14 }, { o: 15, c: 2, h: 1, l: 18 }],
  "Bearish engulfing": [{ o: 12, c: 6, h: 4, l: 14 }, { o: 2, c: 16, h: 1, l: 18 }],
  "Hammer shape": [{ o: 6, c: 2.5, h: 1.5, l: 19 }],
  "Shooting-star shape": [{ o: 14, c: 17.5, h: 1, l: 18.5 }],
  Doji: [{ o: 9.6, c: 10.4, h: 2, l: 18 }],
};
const BODY = 7;
const STEP = 10;

export function PatternGlyph({ name, size = 18 }: { name: string; size?: number }) {
  const candles = SHAPES[name];
  if (!candles) return null;
  const width = candles.length * STEP;
  return (
    <svg className="pf-glyph" width={(size * width) / 20} height={size} viewBox={`0 0 ${width} 20`} aria-hidden="true">
      {candles.map((k, i) => {
        const x = 1.5 + i * STEP;
        const color = name === "Doji" ? "var(--amber)" : k.c < k.o ? "var(--up)" : "var(--down)";
        return (
          <g key={i}>
            <line x1={x + BODY / 2} x2={x + BODY / 2} y1={k.h} y2={k.l} stroke={color} strokeWidth="1.4" />
            <rect x={x} y={Math.min(k.o, k.c)} width={BODY} height={Math.max(1, Math.abs(k.c - k.o))} fill={color} rx="0.8" />
          </g>
        );
      })}
    </svg>
  );
}
