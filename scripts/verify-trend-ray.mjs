/**
 * Visual + interaction check for the trend-line projection: a trend line must
 * carry on past its second point to the right edge of the price pane, and that
 * projected part must be grabbable (drag to pan).
 *
 * Run: node scripts/verify-trend-ray.mjs [baseURL]
 */
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://127.0.0.1:5199";
const shot = "scripts/trend-ray.png";

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
    for (let i = 0; i < 120; i++) s.step();
  });
  await page.waitForTimeout(500);

  const box = await page.locator(".chart-canvas").boundingBox();
  const shapes = () => page.evaluate(() => window.__store.getState().shapes);

  await page.getByRole("button", { name: /^Shapes/ }).click();
  results.trendMenuHint = (await page.locator(".toolbar-menu").innerText()).replace(/\n/g, " | ");
  await page.getByRole("menuitem", { name: /^Trend line/ }).click();

  const t1 = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.55 };
  const t2 = { x: box.x + box.width * 0.62, y: box.y + box.height * 0.38 };
  await page.mouse.click(t1.x, t1.y);
  await page.waitForTimeout(120);
  await page.mouse.click(t2.x, t2.y);
  await page.waitForTimeout(250);
  const created = (await shapes())[0];
  results.created = { kind: created?.kind, hasB: created?.b != null };

  // Geometry of the drawn ray (screen space), straight from the chart mapping.
  const geo = await page.evaluate(() => {
    const s = window.__store.getState().shapes[0];
    const h = window.__chartTest;
    return {
      ax: h.toX(s.a.time),
      ay: h.toY(s.a.price),
      bx: h.toX(s.b.time),
      by: h.toY(s.b.price),
      pane: h.pane(),
    };
  });
  results.geometry = geo;

  // Where the projection should leave the price pane, from the same maths the
  // overlay uses: follow the a→b slope until the first pane edge.
  const dx = geo.bx - geo.ax;
  const dy = geo.by - geo.ay;
  const ts = [];
  if (dx > 1e-6) ts.push((geo.pane.width - geo.bx) / dx);
  if (dy > 1e-6) ts.push((geo.pane.height - geo.by) / dy);
  if (dy < -1e-6) ts.push(-geo.by / dy);
  const tExit = Math.min(...ts);
  const exit = { x: geo.bx + dx * tExit, y: geo.by + dy * tExit };
  results.rayExit = exit;
  results.extensionPx = Math.hypot(exit.x - geo.bx, exit.y - geo.by);
  results.extensionIsLong = results.extensionPx > Math.hypot(dx, dy) * 0.25;

  await page.screenshot({ path: shot });

  // Grab the projected part a third of the way along the projection and pan:
  // if the projection is hit-tested, the shape's times/prices must change.
  const grabLocal = { x: geo.bx + dx * tExit * 0.55, y: geo.by + dy * tExit * 0.55 };
  const grab = { x: box.x + grabLocal.x, y: box.y + grabLocal.y };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x - 40, grab.y + 20, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const after = (await shapes())[0];
  results.projectionDraggable = {
    count: (await shapes()).length,
    aTimeShifted: after.a.time !== created.a.time,
    bothPricesShifted: after.a.price !== created.a.price && after.b.price !== created.b.price,
  };
} catch (e) {
  results.fatal = e.message;
} finally {
  results.consoleErrors = errors;
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.fatal || errors.length > 0) process.exitCode = 1;
