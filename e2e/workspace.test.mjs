import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

// SOURCE: committed July BTC recording. Only the HTTP envelope is SYNTHETIC;
// it exercises the UI offline and must never be presented as a live quote.
const recording = JSON.parse(readFileSync(new URL('../public/demo-market.json', import.meta.url)));
const SYNTHETIC_SNAPSHOT = {
  symbol: 'BTC', asOf: Date.parse(recording.asOf),
  frames: Object.fromEntries(Object.entries(recording.timeframes).map(([tf, value]) => [tf, value.candles])),
};
// SOURCE: local Next.js default. PF_BASE_URL selects a separately started test server.
const baseURL = process.env.PF_BASE_URL || 'http://127.0.0.1:3000';
// GUESS: UNCALIBRATED GUESS — browser-test time budget, not a latency target.
const TEST_TIMEOUT_MS = 120000;
// SOURCE: representative desktop, narrow browser panel and mobile CSS viewport sizes.
const viewports = [{width:1280,height:800},{width:775,height:923},{width:390,height:844}];

for (const viewport of viewports) {
  test(`SYNTHETIC transport: chart and analysis survive the full workflow at ${viewport.width}px`, {timeout:TEST_TIMEOUT_MS}, async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({viewport});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/markets/BTC', route => route.fulfill({json:SYNTHETIC_SNAPSHOT}));
      await page.goto(baseURL);
      const chart = page.getByTestId('professional-market-chart');
      // SOURCE: React commits UI state after the input event; wait for the observable
      // contract instead of assuming selectOption/click synchronously renders it.
      const waitChartAttribute = (name, value) => page.waitForFunction(({name,value}) =>
        document.querySelector('[data-testid="professional-market-chart"]')?.getAttribute(name) === value,
        {name,value});
      await chart.locator('canvas').first().waitFor();
      const assertPlot = async () => {
        const box = await page.locator('.professional-chart-stage').boundingBox();
        // SOURCE: minimum plot height specified in workspace.css, not performance.
        assert.ok(box && box.height >= 320 && box.width > 0, `collapsed plot: ${JSON.stringify(box)}`);
        assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth), false, 'horizontal page overflow');
      };
      await assertPlot(); // Regression: the initial, hidden-analysis chart was zero pixels tall.
      assert.equal(await page.locator('option[value="stored-BTC"]').count(), 0);
      for (const [value, layers] of [['context',['ema','bollinger']],['ema',['ema']],['bands',['bollinger']],['swings',['trendlines']],['patterns',['patterns']],['timeframes',[]],['none',[]]]) {
        await page.getByRole('combobox',{name:'Analysis panel'}).selectOption(value);
        await waitChartAttribute('data-layers', layers.join(','));
        await assertPlot();
        const actual = (await chart.getAttribute('data-layers')).split(',').filter(Boolean);
        assert.deepEqual(actual, layers, `${value}: unexpected overlays`);
      }
      await page.getByRole('combobox',{name:'Analysis panel'}).selectOption('patterns');
      for (const pattern of ['Doji','Hammer shape','Shooting-star shape','Bullish engulfing','Bearish engulfing','all']) {
        await page.getByRole('combobox',{name:'Candlestick pattern'}).selectOption(pattern);
        await assertPlot();
        if (pattern !== 'all') {
          const names = await page.locator('.mw-pattern-hit h3').allTextContents();
          assert.ok(names.every(name => name === pattern));
        }
      }
      assert.ok(Number(await chart.getAttribute('data-marker-count')) > 0);
      await page.locator('.mw-pattern-hit').first().click();
      await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="professional-market-chart"]')?.getAttribute('data-selected-pattern-time')));
      assert.notEqual(await chart.getAttribute('data-selected-pattern-time'), '');
      await page.waitForFunction(() => {
        const plot = document.querySelector('.professional-chart-stage').getBoundingClientRect();
        return plot.top < innerHeight && plot.bottom > 0;
      });
      await page.getByRole('button',{name:'Close analysis',exact:true}).click();
      await assertPlot();
      await page.getByRole('combobox',{name:'Market',exact:true}).selectOption('recorded-XAUUSD');
      await page.getByRole('slider',{name:'Replay position'}).waitFor();
      await page.getByRole('combobox',{name:'Analysis panel'}).selectOption('context');
      const fullCount = Number(await chart.getAttribute('data-bars'));
      await page.getByRole('button',{name:'Previous replay candle'}).click();
      await waitChartAttribute('data-bars', String(fullCount - 1));
      assert.equal(Number(await chart.getAttribute('data-bars')), fullCount - 1);
      await assertPlot();
      for (const pane of ['rsi','macd','none','volume']) {
        await page.getByRole('combobox',{name:'Lower indicator pane'}).selectOption(pane);
        await assertPlot();
      }
      await page.getByRole('combobox',{name:'Drawing tool'}).selectOption('trend');
      const plot = await page.locator('.professional-chart-stage').boundingBox();
      await page.locator('.professional-chart-stage').scrollIntoViewIfNeeded();
      const visiblePlot = await page.locator('.professional-chart-stage').boundingBox();
      // SOURCE: interior points of the measured plot; no financial values are supplied.
      await page.mouse.move(visiblePlot.x + plot.width / 3, visiblePlot.y + plot.height / 3);
      await page.mouse.down();
      await page.mouse.move(visiblePlot.x + plot.width / 2, visiblePlot.y + plot.height / 2);
      await page.mouse.up();
      assert.equal(await page.getByRole('button',{name:'Undo chart drawing'}).isEnabled(), true);
      await page.getByRole('button',{name:'Clear drawings',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Undo chart drawing'}).isEnabled(), false);
      await page.getByRole('combobox',{name:'Market',exact:true}).selectOption('saved-btc');
      await page.getByRole('combobox',{name:'Analysis panel'}).selectOption('case');
      await page.getByRole('slider',{name:'Replay position'}).waitFor();
      await assertPlot();
      if (process.env.PF_SCREENSHOT_DIR) {
        mkdirSync(process.env.PF_SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:`${process.env.PF_SCREENSHOT_DIR}/workspace-${viewport.width}.png`,fullPage:true});
      }
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}

test('SYNTHETIC source outage offers a working historical recording, not fabricated live data', {timeout:TEST_TIMEOUT_MS}, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/api/markets/BTC', route => route.fulfill({status:503,json:{error:'SYNTHETIC upstream outage'}}));
    await page.goto(baseURL);
    await page.getByRole('button',{name:'Open saved BTC recording'}).click();
    await page.getByRole('slider',{name:'Replay position'}).waitFor();
    assert.ok(Number(await page.getByTestId('professional-market-chart').getAttribute('data-bars')) > 0);
    assert.equal(await page.locator('.mw-live-quote').count(), 0);
  } finally { await browser.close(); }
});
