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
      for (const [value, layers] of [['context',[]],['ema',['ema']],['bands',['ema','bollinger']],['swings',['ema','bollinger','trendlines']],['patterns',['ema','bollinger','trendlines','patterns']],['timeframes',['ema','bollinger','trendlines']],['none',['ema','bollinger','trendlines']]]) {
        await page.getByRole('combobox',{name:'Analysis panel'}).selectOption(value);
        await waitChartAttribute('data-layers', layers.join(','));
        await assertPlot();
        const actual = (await chart.getAttribute('data-layers')).split(',').filter(Boolean);
        assert.deepEqual(actual, layers, `${value}: unexpected overlays`);
      }
      // Reading modes must not reset a reviewer's optional layers or lower pane.
      await page.getByRole('combobox',{name:'Lower indicator pane'}).selectOption('volume');
      await page.getByRole('combobox',{name:'Analysis panel'}).selectOption('context');
      await waitChartAttribute('data-lower-panel', 'volume');
      await waitChartAttribute('data-layers', 'ema,bollinger,trendlines');
      await page.getByRole('combobox',{name:'Analysis panel'}).selectOption('patterns');
      await page.getByRole('combobox',{name:'Candlestick pattern'}).selectOption('Bullish engulfing');
      await page.waitForFunction(() => document.querySelector('[data-testid="chart-setup"]')?.textContent.includes('Bullish engulfing'));
      await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="professional-market-chart"]')?.getAttribute('data-selected-pattern-time')));
      const expectedPair = SYNTHETIC_SNAPSHOT.frames['5m'].filter((bar, i, all) => {
        const prev = all[i - 1];
        return prev && prev.c < prev.o && bar.c > bar.o && bar.o <= prev.c && bar.c >= prev.o;
      }).at(-1);
      assert.ok(expectedPair, 'the real recording must contain the demonstrated pair');
      assert.equal(Number(await chart.getAttribute('data-selected-pattern-time')), Math.floor(Number(expectedPair.t) / 1000));
      if (process.env.PF_SCREENSHOT_DIR) {
        mkdirSync(process.env.PF_SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:`${process.env.PF_SCREENSHOT_DIR}/engulfing-${viewport.width}.png`,fullPage:true});
      }
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
      await page.getByText('Inspect tools', {exact:true}).click();
      await page.getByRole('combobox',{name:'Drawing tool'}).selectOption('trend');
      const plot = await page.locator('.professional-chart-stage').boundingBox();
      await page.locator('.professional-chart-stage').scrollIntoViewIfNeeded();
      const visiblePlot = await page.locator('.professional-chart-stage').boundingBox();
      // SOURCE: interior points of the measured plot; no financial values are supplied.
      await page.mouse.move(visiblePlot.x + plot.width / 3, visiblePlot.y + plot.height / 3);
      await page.mouse.down();
      await page.mouse.move(visiblePlot.x + plot.width / 2, visiblePlot.y + plot.height / 2);
      await page.mouse.up();
      await page.waitForFunction(() => document.querySelector('[aria-label="Undo chart drawing"]')?.disabled === false);
      assert.equal(await page.getByRole('button',{name:'Undo chart drawing'}).isEnabled(), true);
      await page.getByText('Inspect tools', {exact:true}).click();
      await page.getByRole('button',{name:'Clear drawings',exact:true}).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Undo chart drawing"]')?.disabled === true);
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
      await page.goto(`${baseURL}/about`);
      await page.waitForURL('**/#how-it-works');
      assert.match(await page.locator('.mw-intro').innerText(), /3 public crypto markets · 10 market recordings · 1 saved BTC case/);
      await page.locator('.mw-build-guide > summary').click();
      assert.equal(await page.getByRole('heading', {level:1}).count(), 1);
      assert.equal(await page.locator('.pf-guide').getByRole('table').count(), 4);
      assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth), false, 'guide overflow');
      if (process.env.PF_SCREENSHOT_DIR) await page.screenshot({path:`${process.env.PF_SCREENSHOT_DIR}/guide-${viewport.width}.png`,fullPage:true});
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

test('SYNTHETIC 4h preview changes without rewriting closed evidence', {timeout:TEST_TIMEOUT_MS}, async () => {
  // SOURCE: constructed hourly observations, explicitly SYNTHETIC; not a real market example.
  const hour = 60*60*1000;
  const candles = [[110,107],[107,104],[104,102],[102,100],[99,111],[111,108],[108,113],[113,112]]
    .map(([o,c],i) => ({t:i*hour,closeTime:(i+1)*hour,o,c,h:Math.max(o,c),l:Math.min(o,c),closed:true}));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/markets/BTC', route => route.fulfill({json:SYNTHETIC_SNAPSHOT}));
    await page.route('**/recordings/XAUUSD.json', route => route.fulfill({json:{metadata:{id:'recorded-XAUUSD',asOf:8*hour},candles}}));
    await page.goto(baseURL);
    await page.getByRole('combobox',{name:'Market',exact:true}).selectOption('recorded-XAUUSD');
    const slider = page.getByRole('slider',{name:'Replay position'});
    await slider.waitFor();
    await page.getByRole('group',{name:'Chart timeframe'}).getByRole('button',{name:'4h',exact:true}).click();
    await page.getByRole('combobox',{name:'Analysis panel'}).selectOption('patterns');
    await page.getByRole('checkbox',{name:'Preview forming 4h'}).check();
    await slider.focus();
    await slider.press('Home');
    // SOURCE: five source bars reveal the first provisional body after one complete 4h group.
    for (let i=0;i<4;i++) await slider.press('ArrowRight');
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
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/api/markets/BTC', route => route.fulfill({json:SYNTHETIC_SNAPSHOT}));
    await page.goto(baseURL);
    await page.getByRole('combobox',{name:'Market',exact:true}).selectOption('recorded-XAUUSD');
    const slider = page.getByRole('slider',{name:'Replay position'});
    await slider.waitFor();
    await page.getByRole('group',{name:'Chart timeframe'}).getByRole('button',{name:'4h',exact:true}).click();
    await page.getByRole('combobox',{name:'Analysis panel'}).selectOption('patterns');
    await page.getByRole('checkbox',{name:'Preview forming 4h'}).check();
    await slider.evaluate((input,value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));
      input.dispatchEvent(new Event('input',{bubbles:true}));
    },candidate.index+1);
    await page.waitForFunction(time => document.querySelector('[data-testid="professional-market-chart"]')?.getAttribute('data-provisional-time') === String(time),candidate.preview.bar.t);
    const chart = page.getByTestId('professional-market-chart');
    assert.equal(await chart.getAttribute('data-setup'),'Bullish engulfing · provisional');
    assert.equal(Number(await chart.getAttribute('data-bars')),expected.length);
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button',{name:'Export ↓',exact:true}).click();
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
