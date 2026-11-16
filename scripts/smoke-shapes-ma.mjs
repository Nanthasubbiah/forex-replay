/**
 * Interaction smoke test for the Shapes and Indicators toolbars:
 * vertical / horizontal / trend line placement + dragging, moving-average
 * settings, click-to-edit and Clear.
 *
 * Run: node scripts/smoke-shapes-ma.mjs [baseURL]
 */
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://127.0.0.1:5199";
const shot = "scripts/smoke-shapes-ma.png";

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
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

  // ---- demo data, advance enough bars for a 20-period MA
  await page.getByRole("button", { name: "Demo data" }).click();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const s = window.__store.getState();
    for (let i = 0; i < 120; i++) s.step();
  });
  await page.waitForTimeout(500);

  const box = await page.locator(".chart-canvas").boundingBox();
  const stGet = () =>
    page.evaluate(() => {
      const s = window.__store.getState();
      return {
        shapes: s.shapes,
        shapeTool: s.shapeTool,
        shapeAnchor: s.shapeAnchor,
        indicators: s.indicators,
        editor: s.indicatorEditorId,
        pos: s.pos,
      };
    });
  const toPage = async (time, price) => {
    const pt = await page.evaluate(
      ({ time, price }) => {
        const h = window.__chartTest;
        return { x: h.toX(time), y: h.toY(price) };
      },
      { time, price },
    );
    return { x: box.x + pt.x, y: box.y + pt.y };
  };
  const menuText = async () => (await page.locator(".toolbar-menu").innerText()).replace(/\n/g, " | ");

  // ---- vertical line: one click, then drag to pan
  await page.getByRole("button", { name: /^Shapes/ }).click();
  results.shapesMenu = await menuText();
  await page.getByRole("menuitem", { name: /^Vertical line/ }).click();
  results.verticalHint = await page.locator(".tool-hint").innerText();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.45);
  await page.waitForTimeout(150);
  let st = await stGet();
  results.verticalCreated = {
    count: st.shapes.length,
    kind: st.shapes[0]?.kind,
    hasB: st.shapes[0]?.b != null,
    toolCleared: st.shapeTool === null,
  };

  const v = st.shapes[0];
  const vx = (await toPage(v.a.time, v.a.price)).x;
  await page.mouse.move(vx, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(vx + 80, box.y + box.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  st = await stGet();
  results.verticalDrag = {
    timeChanged: st.shapes[0].a.time !== v.a.time,
    count: st.shapes.length,
  };

  // ---- horizontal line: one click, then drag to pan
  await page.getByRole("button", { name: /^Shapes/ }).click();
  await page.getByRole("menuitem", { name: /^Horizontal line/ }).click();
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.7);
  await page.waitForTimeout(150);
  st = await stGet();
  results.horizontalCreated = { count: st.shapes.length, kind: st.shapes[1]?.kind };
  const h = st.shapes[1];
  const hy = (await toPage(h.a.time, h.a.price)).y;
  await page.mouse.move(box.x + box.width * 0.5, hy);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, hy + 45, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  st = await stGet();
  results.horizontalDrag = { priceChanged: st.shapes[1].a.price !== h.a.price };

  // ---- trend line: two clicks, drag the whole segment and one endpoint
  await page.getByRole("button", { name: /^Shapes/ }).click();
  await page.getByRole("menuitem", { name: /^Trend line/ }).click();
  results.trendHint1 = await page.locator(".tool-hint").innerText();
  const t1 = { x: box.x + box.width * 0.58, y: box.y + box.height * 0.3 };
  const t2 = { x: box.x + box.width * 0.78, y: box.y + box.height * 0.52 };
  await page.mouse.click(t1.x, t1.y);
  await page.waitForTimeout(100);
  results.trendHint2 = await page.locator(".tool-hint").innerText();
  await page.mouse.click(t2.x, t2.y);
  await page.waitForTimeout(200);
  st = await stGet();
  results.trendCreated = {
    count: st.shapes.length,
    kind: st.shapes[2]?.kind,
    hasB: st.shapes[2]?.b != null,
    toolCleared: st.shapeTool === null,
  };
  const trend = st.shapes[2];
  const aPt = await toPage(trend.a.time, trend.a.price);
  const bPt = await toPage(trend.b.time, trend.b.price);
  const mid = { x: (aPt.x + bPt.x) / 2, y: (aPt.y + bPt.y) / 2 };
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 60, mid.y + 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const stTrendMove = await stGet();
  const movedTrend = stTrendMove.shapes[2];
  results.trendDrag = {
    bothPricesMoved:
      Math.abs(movedTrend.a.price - trend.a.price) > 0.00001 &&
      Math.abs(movedTrend.b.price - trend.b.price) > 0.00001,
    equalDelta:
      Math.abs(movedTrend.a.price - trend.a.price - (movedTrend.b.price - trend.b.price)) < 1e-9,
    timesShifted: movedTrend.a.time !== trend.a.time && movedTrend.b.time !== trend.b.time,
  };

  // drag endpoint A of the trend line
  const endA = await toPage(movedTrend.a.time, movedTrend.a.price);
  await page.mouse.move(endA.x, endA.y);
  await page.mouse.down();
  await page.mouse.move(endA.x - 35, endA.y + 25, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const stEnd = await stGet();
  const trendAfterEnd = stEnd.shapes[2];
  results.trendEndpointDrag = {
    aChanged: trendAfterEnd.a.price !== movedTrend.a.price,
    bUnchanged: trendAfterEnd.b.price === movedTrend.b.price && trendAfterEnd.b.time === movedTrend.b.time,
  };

  // ---- indicators: add MA, edit settings
  await page.getByRole("button", { name: /^Indicators/ }).click();
  results.indicatorsMenu = await menuText();
  await page.getByRole("menuitem", { name: /^Moving average/ }).click();
  await page.waitForTimeout(250);
  st = await stGet();
  results.maAdded = { count: st.indicators.length, editorOpen: st.editor != null };
  results.maEditorVisible = await page.locator(".ma-editor").isVisible();

  await page.locator(".ma-editor input[type=number]").first().fill("12");
  await page.locator(".ma-editor select").selectOption("1");
  await page.locator(".ma-editor .fib-swatch").nth(1).click();
  const boxes = page.locator(".ma-editor .ma-toggle input[type=checkbox]");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.locator(".ma-editor input[type=number]").nth(1).fill("8");
  await page.waitForTimeout(250);
  st = await stGet();
  results.maSettings = {
    period: st.indicators[0].params.period,
    method: st.indicators[0].params.method,
    colored: st.indicators[0].params.colored,
    showBounds: st.indicators[0].params.showBounds,
    boundPips: st.indicators[0].params.boundPips,
    colors: st.indicators[0].colors,
  };
  await page.screenshot({ path: "scripts/smoke-ma-editor.png" });
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(200);
  results.editorClosedAfterDone = !(await page.locator(".ma-editor").isVisible());

  // ---- click the MA line on the chart -> settings window reopens
  const maPoint = await page.evaluate(() => {
    const s = window.__store.getState();
    const h = window.__chartTest;
    const id = s.indicators[0].id;
    const range = h.visibleRange();
    const from = range ? Math.max(0, Math.ceil(range.from)) : 0;
    const to = range ? Math.min(s.pos - 1, Math.floor(range.to)) : s.pos - 1;
    const idx = Math.min(s.pos - 1, Math.max(0, from + Math.floor((to - from) * 0.25)));
    return h.maPoint(id, idx);
  });
  results.maPointFound = maPoint != null;
  if (maPoint) {
    await page.mouse.click(box.x + maPoint.x, box.y + maPoint.y);
    await page.waitForTimeout(250);
    results.maEditorFromClick = await page.locator(".ma-editor").isVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(150);

    // right-click the MA -> settings window
    await page.mouse.click(box.x + maPoint.x, box.y + maPoint.y, { button: "right" });
    await page.waitForTimeout(250);
    results.maEditorFromRightClick = await page.locator(".ma-editor").isVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(150);
  }

  // ---- right-click a line -> edit colour / remove
  const shapeNow = (await stGet()).shapes[0];
  const shapePt = await toPage(shapeNow.a.time, shapeNow.a.price);
  await page.mouse.click(shapePt.x, box.y + box.height * 0.5, { button: "right" });
  await page.waitForTimeout(200);
  results.shapeMenuItems = (await page.locator(".ctx-item").allInnerTexts()).map((t) => t.trim());
  await page.getByRole("button", { name: "Edit colour…" }).click();
  await page.waitForTimeout(200);
  await page.locator(".fib-swatch").nth(3).click();
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(200);
  results.shapeColor = (await stGet()).shapes[0].color;

  await page.screenshot({ path: shot });

  // ---- Clear removes drawings but keeps indicators
  await page.getByRole("button", { name: "Clear" }).click();
  await page.waitForTimeout(250);
  st = await stGet();
  results.afterClear = { shapes: st.shapes.length, indicators: st.indicators.length, editor: st.editor };
} catch (e) {
  results.fatal = e.message;
} finally {
  results.consoleErrors = errors;
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.fatal || errors.length > 0) process.exitCode = 1;
