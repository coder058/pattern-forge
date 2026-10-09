import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { aggregateBars, formingFourHour } from '../app/marketAnalysis.ts';

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

// SOURCE: CI installs Playwright's Chromium; PF_CHROMIUM points at a preinstalled one elsewhere.
const launch = () => chromium.launch(process.env.PF_CHROMIUM ? {executablePath: process.env.PF_CHROMIUM} : {});
// The first-visit guide is covered by its own test; workflow tests start without it.
const skipGuide = page => page.addInitScript(() => localStorage.setItem('pf-guide-v2-seen', '1'));
const setSlider = (slider, value) => slider.evaluate((input, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
  input.dispatchEvent(new Event('input', {bubbles: true}));
}, value);

for (const viewport of viewports) {
  test(`SYNTHETIC transport: chart and analysis survive the full workflow at ${viewport.width}px`, {timeout:TEST_TIMEOUT_MS}, async () => {
    const browser = await launch();
    try {
      const page = await browser.newPage({viewport});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/markets/BTC', route => route.fulfill({json:SYNTHETIC_SNAPSHOT}));
      await skipGuide(page);
      await page.goto(baseURL);
      const chart = page.getByTestId('professional-market-chart');
      // SOURCE: React commits UI state after the input event; wait for the observable
      // contract instead of assuming a click synchronously renders it.
      const waitChartAttribute = (name, value) => page.waitForFunction(({name,value}) =>
        document.querySelector('[data-testid="professional-market-chart"]')?.getAttribute(name) === value,
        {name,value});
      await chart.locator('canvas').first().waitFor();
      const assertPlot = async () => {
        const box = await page.locator('.professional-chart-stage').boundingBox();
        // SOURCE: minimum plot height specified in workspace.css, not performance.
        assert.ok(box && box.height >= 240 && box.width > 0, `collapsed plot: ${JSON.stringify(box)}`);
        assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth), false, 'horizontal page overflow');
      };
      await assertPlot();
      // SOURCE: 9 October redesign: the product opens on the chart, explanation lives on /about.
      const firstPlot = await page.locator('.professional-chart-stage').boundingBox();
      assert.ok(firstPlot.y < viewport.height / 2, `chart must start in the upper half of the first screen: ${firstPlot.y}`);
      assert.equal(await page.getByRole('heading', {level:1}).count(), 1);
      // Default: a recording that always loads, with candlestick markers visible.
      await waitChartAttribute('data-layers', 'patterns');
      assert.ok(Number(await chart.getAttribute('data-marker-count')) > 0);
      assert.equal(await page.locator('[aria-label="Search markets"]').count(), 1);
      assert.equal(await page.getByRole('button', {name: /Stored/}).count(), 0);

      // Pattern filters keep the list and the markers to the chosen shape.
      for (const pattern of ['Doji','Hammer shape','Shooting-star shape','Bearish engulfing','Bullish engulfing']) {
        await page.getByRole('group',{name:'Candlestick pattern'}).getByRole('button',{name:new RegExp('^' + pattern.replace(' shape','').replace('-shape',''))}).click();
        await assertPlot();
        const names = await page.locator('.mw-pattern-hit strong').allTextContents();
        assert.ok(names.length && names.every(name => name === pattern), `${pattern}: ${names}`);
      }
      await page.waitForFunction(() => document.querySelector('[data-testid="chart-setup"]')?.textContent.includes('Bullish engulfing'));
      await page.locator('.mw-pattern-hit').nth(1).click();
      const picked = await page.locator('.mw-pattern-hit.is-active time').textContent();
      await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="professional-market-chart"]')?.getAttribute('data-selected-pattern-time')));
      assert.match(await page.getByTestId('chart-setup').innerText(), new RegExp(picked.replace(' UTC','')));

      // Closing the panel keeps the reading and markers; it can be reopened.
      const readingBeforeClose = await page.getByTestId('chart-setup').innerText();
      const markersBeforeClose = await chart.getAttribute('data-marker-count');
      await page.getByRole('button',{name:'Close analysis',exact:true}).click();
      assert.equal(await page.getByTestId('chart-setup').innerText(), readingBeforeClose);
      assert.equal(await chart.getAttribute('data-marker-count'), markersBeforeClose);
      assert.equal(await page.getByRole('complementary',{name:'Analysis',exact:true}).count(), 0);
      await page.getByRole('button',{name:'Open analysis',exact:true}).click();
      assert.equal(await page.getByRole('complementary',{name:'Analysis',exact:true}).count(), 1);
      await assertPlot();

      // Trend tab shows the lines it refers to; layers stay under the reader's control.
      await page.getByRole('tab',{name:'Trend'}).click();
      await waitChartAttribute('data-layers', 'ema,bollinger,patterns');
      await page.waitForFunction(() => document.querySelector('[data-testid="chart-setup"]')?.textContent.length > 10);
      await page.getByRole('button',{name:'Hide EMA and bands'}).click();
      await waitChartAttribute('data-layers', 'patterns');
      await page.getByRole('tab',{name:'Timeframes'}).click();
      await assertPlot();

      // Bar replay: rewinding removes later candles; stepping adds exactly one.
      const fullCount = Number(await chart.getAttribute('data-bars'));
      await page.getByRole('button',{name:/Replay/}).first().click();
      const slider = page.getByRole('slider',{name:'Replay position'});
      await slider.waitFor();
      await page.getByRole('button',{name:'Pause replay'}).click().catch(() => {});
      await setSlider(slider, 300);
      await page.waitForFunction(full => Number(document.querySelector('[data-testid="professional-market-chart"]')?.getAttribute('data-bars')) < full, fullCount);
      const rewound = Number(await chart.getAttribute('data-bars'));
      assert.ok(rewound < fullCount);
      await page.getByRole('button',{name:'Play replay'}).click();
      await page.waitForFunction(n => Number(document.querySelector('[aria-label="Replay position"]')?.value) > n, 300);
      await page.getByRole('button',{name:'Pause replay'}).click();
      await assertPlot();
      await page.getByRole('button',{name:'Jump to end'}).click();
      await waitChartAttribute('data-bars', String(fullCount));

      for (const pane of ['RSI 14','MACD','Off','Volume']) {
        await page.locator('.pf-menu > summary').click();
        await page.getByRole('radio',{name:pane}).check();
        await page.keyboard.press('Escape');
        await assertPlot();
      }

      if (viewport.width > 900) {
        await page.getByRole('button',{name:'Trendline',exact:true}).click();
        const plot = await page.locator('.professional-chart-stage').boundingBox();
        // SOURCE: interior points of the measured plot; no financial values are supplied.
        await page.mouse.move(plot.x + plot.width / 3, plot.y + plot.height / 3);
        await page.mouse.down();
        await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 2);
        await page.mouse.up();
        await page.waitForFunction(() => document.querySelector('[aria-label="Undo chart drawing"]')?.disabled === false);
        await page.getByRole('button',{name:'Clear drawings',exact:true}).click();
        // Clearing returns to the crosshair; with nothing to undo the button is disabled or hidden.
        await page.waitForFunction(() => {
          const undo = document.querySelector('[aria-label="Undo chart drawing"]');
          return !undo || undo.disabled;
        });
      }

      // Market search: type and press Enter.
      await page.locator('.pf-symbol > summary').click();
      await page.getByRole('searchbox',{name:'Search markets'}).fill('btc');
      await page.getByRole('searchbox',{name:'Search markets'}).press('Enter');
      await page.waitForFunction(() => document.querySelector('.pf-title h2')?.textContent.startsWith('Bitcoin'));
      await assertPlot();
      assert.equal(await page.getByRole('button',{name:/Replay/}).count(), 0, 'live snapshots have no replay');
      await page.locator('.pf-symbol > summary').click();
      await page.getByRole('button',{name:/Saved BTC case/}).click();
      await page.getByRole('tab',{name:'Case'}).waitFor();
      await assertPlot();
      if (process.env.PF_SCREENSHOT_DIR) {
        mkdirSync(process.env.PF_SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:`${process.env.PF_SCREENSHOT_DIR}/workspace-${viewport.width}.png`,fullPage:true});
      }
      assert.deepEqual(errors, []);

      await page.goto(`${baseURL}/about`);
      assert.equal(await page.getByRole('heading', {level:1}).count(), 1);
      assert.match(await page.locator('main').textContent(), /3 public crypto markets/);
      assert.equal(await page.locator('table').count(), 5);
      assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth), false, 'guide overflow');
      if (process.env.PF_SCREENSHOT_DIR) await page.screenshot({path:`${process.env.PF_SCREENSHOT_DIR}/guide-${viewport.width}.png`,fullPage:true});
    } finally { await browser.close(); }
  });
}

test('first visit shows a short guide once', {timeout:TEST_TIMEOUT_MS}, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(baseURL);
    const guide = page.getByRole('complementary',{name:'Quick guide'});
    await guide.waitFor();
    await page.getByRole('button',{name:'Got it'}).click();
    assert.equal(await guide.count(), 0);
    await page.reload();
    await page.getByTestId('professional-market-chart').waitFor();
    assert.equal(await guide.count(), 0, 'guide must not return after it is dismissed');
    await page.getByRole('button',{name:'Show the quick guide'}).click();
    await guide.waitFor();
  } finally { await browser.close(); }
});

test('SYNTHETIC source outage offers a working historical recording, not fabricated live data', {timeout:TEST_TIMEOUT_MS}, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.route('**/api/markets/BTC', route => route.fulfill({status:503,json:{error:'SYNTHETIC upstream outage'}}));
    await skipGuide(page);
    await page.goto(baseURL);
    await page.getByTestId('professional-market-chart').waitFor();
    await page.locator('.pf-symbol > summary').click();
    await page.getByRole('button',{name:/^BTC · Bitcoin/}).click();
    await page.getByRole('button',{name:'Open the Gold recording'}).click();
    await page.getByRole('button',{name:/Replay/}).first().waitFor();
    assert.ok(Number(await page.getByTestId('professional-market-chart').getAttribute('data-bars')) > 0);
    assert.equal(await page.locator('.mw-live-quote').count(), 0);
  } finally { await browser.close(); }
});

test('SYNTHETIC 4h preview changes without rewriting closed evidence', {timeout:TEST_TIMEOUT_MS}, async () => {
  // SOURCE: constructed hourly observations, explicitly SYNTHETIC; not a real market example.
  const hour = 60*60*1000;
  const candles = [[110,107],[107,104],[104,102],[102,100],[99,111],[111,108],[108,113],[113,112]]
    .map(([o,c],i) => ({t:i*hour,closeTime:(i+1)*hour,o,c,h:Math.max(o,c),l:Math.min(o,c),closed:true}));
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/markets/BTC', route => route.fulfill({json:SYNTHETIC_SNAPSHOT}));
    await page.route('**/recordings/XAUUSD.json', route => route.fulfill({json:{metadata:{id:'recorded-XAUUSD',asOf:8*hour},candles}}));
    await skipGuide(page);
    await page.goto(baseURL);
    await page.getByTestId('professional-market-chart').waitFor();
    await page.getByRole('group',{name:'Chart timeframe'}).getByRole('button',{name:'4h',exact:true}).click();
    await page.getByRole('button',{name:/Replay/}).first().click();
    const slider = page.getByRole('slider',{name:'Replay position'});
    await slider.waitFor();
    await page.getByRole('button',{name:'Pause replay'}).click().catch(() => {});
    await page.getByRole('checkbox',{name:/Preview the forming 4h candle/}).check();
    // SOURCE: five source bars reveal the first provisional body after one complete 4h group.
    await setSlider(slider, 5);
    const chart = page.getByTestId('professional-market-chart');
    const waitSetup = value => page.waitForFunction(value =>
      document.querySelector('[data-testid="professional-market-chart"]')?.getAttribute('data-setup') === value, value);
    await waitSetup('Bullish engulfing · provisional');
    assert.equal(await chart.getAttribute('data-bars'), '1');
    assert.equal(await chart.getAttribute('data-provisional-time'), String(4*hour));
    await page.getByRole('button',{name:'Next replay candle'}).click();
    await waitSetup('No selected engulfing shape yet');
    assert.equal(await chart.getAttribute('data-bars'), '1');
    await page.getByRole('button',{name:'Next replay candle'}).click();
    await waitSetup('Bullish engulfing · provisional');
    await page.getByRole('button',{name:'Next replay candle'}).click();
    await waitSetup('No partial 4h candle available');
    assert.equal(await chart.getAttribute('data-provisional-time'), '');
    assert.equal(await chart.getAttribute('data-bars'), '2');
    await page.getByRole('button',{name:'Previous replay candle'}).click();
    await waitSetup('Bullish engulfing · provisional');
    assert.equal(await chart.getAttribute('data-bars'), '1');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('recorded GOLD archive: forming preview and export agree with the available prefix', {timeout:TEST_TIMEOUT_MS}, async () => {
  // SOURCE: committed historical perpetual-contract archive, not a live gold spot feed.
  const archive = JSON.parse(readFileSync(new URL('../public/recordings/XAUUSD.json', import.meta.url)));
  const candidate = archive.candles.map((bar,index) => ({index, preview:formingFourHour(archive.candles,bar.closeTime)}))
    .find(({preview}) => preview?.shape === 'Bullish engulfing' && aggregateBars(archive.candles,'1h','4h',preview.through).length > 1);
  assert.ok(candidate, 'archive must actually contain the demonstrated shape');
  const expected = aggregateBars(archive.candles,'1h','4h',candidate.preview.through);
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.route('**/api/markets/BTC', route => route.fulfill({json:SYNTHETIC_SNAPSHOT}));
    await skipGuide(page);
    await page.goto(baseURL);
    await page.getByTestId('professional-market-chart').waitFor();
    await page.getByRole('group',{name:'Chart timeframe'}).getByRole('button',{name:'4h',exact:true}).click();
    await page.getByRole('button',{name:/Replay/}).first().click();
    const slider = page.getByRole('slider',{name:'Replay position'});
    await slider.waitFor();
    await page.getByRole('button',{name:'Pause replay'}).click().catch(() => {});
    await page.getByRole('checkbox',{name:/Preview the forming 4h candle/}).check();
    await setSlider(slider, candidate.index+1);
    await page.waitForFunction(time => document.querySelector('[data-testid="professional-market-chart"]')?.getAttribute('data-provisional-time') === String(time),candidate.preview.bar.t);
    const chart = page.getByTestId('professional-market-chart');
    assert.equal(await chart.getAttribute('data-setup'),'Bullish engulfing · provisional');
    assert.equal(Number(await chart.getAttribute('data-bars')),expected.length);
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button',{name:'Export JSON ↓',exact:true}).click();
    const exported = JSON.parse(readFileSync(await (await downloadReady).path(),'utf8'));
    assert.deepEqual(exported.candles,expected);
    assert.equal(exported.replayCutoff,candidate.preview.through);
    assert.ok(exported.candles.every(bar => bar.closed && bar.closeTime <= exported.replayCutoff));
    if (process.env.PF_SCREENSHOT_DIR) {
      mkdirSync(process.env.PF_SCREENSHOT_DIR,{recursive:true});
      await page.screenshot({path:`${process.env.PF_SCREENSHOT_DIR}/recorded-forming.png`,fullPage:true});
    }
  } finally { await browser.close(); }
});
