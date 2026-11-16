/**
 * Quick verification of the indicator registry (RSI / MACD / ATR / Bollinger
 * panes + price-pane overlays). Run with the dev server up:
 *   node scripts/verify-indicators.mjs [baseURL]
 */
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://127.0.0.1:5199";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
const results = {};

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator(".topbar").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: "Demo data" }).click();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const s = window.__store.getState();
    for (let i = 0; i < 300; i++) s.step();
  });
  await page.waitForTimeout(800);

  const addIndicator = async (label) => {
    await page.getByRole("button", { name: /^Indicators/ }).click();
    await page.getByRole("menuitem", { name: new RegExp(`^${label}`) }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(200);
  };
  await addIndicator("RSI");
  await addIndicator("MACD");
  await addIndicator("ATR");
  await addIndicator("Moving average");

  const state = await page.evaluate(() => window.__store.getState().indicators.map((i) => ({ kind: i.kind, params: i.params })));
  results.indicators = state;
  results.indicatorsMenu = await page.evaluate(() =>
    window.__store.getState().indicators.map((i) => i.kind),
  );

  // panes: price pane + 3 oscillators
  results.pane = await page.evaluate(() => window.__chartTest.pane());
  results.chartInfo = await page.evaluate(() => {
    const chart = window.__chartTest;
    return { visible: chart.visibleRange() };
  });
  await page.screenshot({ path: "scripts/verify-indicators.png" });

  // replay advances without errors and one of the panes' series updates
  await page.evaluate(() => {
    const s = window.__store.getState();
    for (let i = 0; i < 50; i++) s.step();
  });
  await page.waitForTimeout(400);
  results.afterStep = await page.evaluate(() => {
    const s = window.__store.getState();
    return { pos: s.pos, indicators: s.indicators.length };
  });

  // the MA overlay actually paints pixels on the price pane
  results.overlayPixels = await page.evaluate(() => {
    const canvas = document.querySelector(".chart-overlay");
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let amber = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const [r, g, b, a] = [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
      if (a > 200 && r > 200 && g > 100 && g < 200 && b < 80) amber++;
    }
    return { amber };
  });

  // replay reset rewinds the pane series instead of breaking them
  await page.evaluate(() => window.__store.getState().reset());
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const s = window.__store.getState();
    for (let i = 0; i < 60; i++) s.step();
  });
  await page.waitForTimeout(300);
  results.afterReset = await page.evaluate(() => {
    const s = window.__store.getState();
    return { pos: s.pos, indicators: s.indicators.length };
  });

  // editing a pane indicator rebuilds its series; removing all collapses panes
  await page.evaluate(() => {
    const s = window.__store.getState();
    const rsi = s.indicators.find((i) => i.kind === "rsi");
    if (rsi) s.updateIndicator({ ...rsi, params: { ...rsi.params, period: 7 } });
  });
  await page.waitForTimeout(300);
  results.edited = await page.evaluate(() => {
    const s = window.__store.getState();
    const rsi = s.indicators.find((i) => i.kind === "rsi");
    return rsi ? rsi.params.period : null;
  });
  await page.evaluate(() => window.__store.getState().clearIndicators());
  await page.waitForTimeout(300);
  results.paneAfterClear = await page.evaluate(() => window.__chartTest.pane());
  results.indicatorsAfterClear = await page.evaluate(() => window.__store.getState().indicators.length);
} catch (e) {
  results.fatal = e.message;
} finally {
  results.consoleErrors = errors;
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.fatal || errors.length > 0) process.exitCode = 1;
