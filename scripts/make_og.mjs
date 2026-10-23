// Regenerate public/og.png (1200×630 social card) and docs/screenshot.png (README) from the running app.
//   npm run build && npx next start -p 3000   # in another terminal
//   node scripts/make_og.mjs                  # PF_BASE_URL / PF_CHROMIUM optional
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PF_BASE_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch(process.env.PF_CHROMIUM ? { executablePath: process.env.PF_CHROMIUM } : {});
try {
  // 1. A real screenshot of the default view (Gold recording, engulfing shapes marked).
  const app = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 });
  await app.addInitScript(() => localStorage.setItem('pf-guide-v2-seen', '1'));
  await app.goto(`${base}/?market=recorded-XAUUSD&tf=4h&tab=patterns`, { waitUntil: 'networkidle' });
  await app.getByTestId('professional-market-chart').locator('canvas').first().waitFor();
  await app.waitForTimeout(800);
  const shot = (await app.screenshot({ clip: { x: 44, y: 48, width: 1136, height: 712 } })).toString('base64');

  // 2. The card: a short promise on the left, the actual product on the right.
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await card.setContent(`<!doctype html><html><head><style>
    body { margin: 0; width: 1200px; height: 630px; background: #131722; color: #f0f3fa;
      font-family: -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif; overflow: hidden; }
    .wrap { display: grid; grid-template-columns: 450px 1fr; height: 100%; }
    .copy { padding: 64px 0 56px 64px; display: flex; flex-direction: column; }
    .brand { display: flex; align-items: center; gap: 12px; font-size: 26px; font-weight: 700; }
    .brand i { width: 22px; height: 22px; background: #2962ff; transform: rotate(45deg); border-radius: 3px; }
    h1 { font-size: 42px; line-height: 1.08; letter-spacing: -0.02em; margin: 44px 0 22px; }
    p { color: #b7bbc5; font-size: 21px; line-height: 1.45; margin: 0; }
    ul { list-style: none; padding: 0; margin: auto 0 0; display: grid; gap: 12px; font-size: 19px; color: #d1d4dc; }
    li::before { content: "◆"; color: #2962ff; margin-right: 10px; font-size: 14px; }
    .shot { margin: 40px 0 40px 8px; border-radius: 14px 0 0 14px; overflow: hidden;
      box-shadow: 0 30px 80px rgba(0,0,0,.55); border: 1px solid #2a2e39; border-right: 0; }
    .shot img { display: block; height: 100%; }
  </style></head><body><div class="wrap">
    <div class="copy">
      <div class="brand"><i></i>Pattern Forge</div>
      <h1>Read candlestick patterns without hindsight</h1>
      <p>Patterns appear only when their candle closes.</p>
      <ul><li>Bar replay</li><li>Murphy trend reading</li><li>Backtest against random entries</li></ul>
    </div>
    <div class="shot"><img src="data:image/png;base64,${shot}"></div>
  </div></body></html>`);
  writeFileSync(new URL('../public/og.png', import.meta.url), await card.screenshot());
  console.log('public/og.png written');

  // 3. The README screenshot: the whole default view at a common laptop size.
  const readme = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  await readme.addInitScript(() => localStorage.setItem('pf-guide-v2-seen', '1'));
  await readme.goto(`${base}/?market=recorded-XAUUSD&tf=4h&tab=patterns`, { waitUntil: 'networkidle' });
  await readme.getByTestId('professional-market-chart').locator('canvas').first().waitFor();
  await readme.waitForTimeout(800);
  await readme.screenshot({ path: new URL('../docs/screenshot.png', import.meta.url).pathname });
  console.log('docs/screenshot.png written');
} finally {
  await browser.close();
}
