/**
 * Symbol-box smoke test: the top-bar Symbol field must re-label the loaded data
 * (and rebuild the simulator with the matching contract spec), reject junk, and
 * decide the symbol for files whose name carries none.
 *
 * Run: node scripts/smoke-symbol.mjs [baseURL] [fileWithoutSymbolInName]
 */
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://127.0.0.1:5173";
const file = process.argv[3] ?? "2026.json.gz";
const shot = "scripts/smoke-symbol.png";

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
const storeState = () =>
  page.evaluate(() => {
    const s = window.__store.getState();
    return {
      symbol: s.symbol,
      loadedSymbol: s.loaded?.symbol ?? null,
      simSymbol: s.sim?.symbol ?? null,
      sourceName: s.loaded?.sourceName ?? null,
      pos: s.pos,
      bars: s.loaded?.bars.length ?? 0,
      shares: s.shapes.length,
      toast: s.toast?.message ?? null,
      toastKind: s.toast?.kind ?? null,
    };
  });

const symbolInput = () => page.locator(".symbol-field input");

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator(".topbar").waitFor({ state: "visible", timeout: 15_000 });

  results.initial = {
    box: await symbolInput().inputValue(),
    hud: (await page.locator(".hud-symbol").count()) ? (await page.locator(".hud-symbol").innerText()).trim() : null,
  };

  // ---- demo data, then re-label it as GBPUSD
  await page.getByRole("button", { name: "Demo data" }).click();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const s = window.__store.getState();
    for (let i = 0; i < 60; i++) s.step();
  });

  // a drawing must survive the re-label
  await page.evaluate(() => {
    const s = window.__store.getState();
    s.addShape({ id: 99, kind: "horizontal", a: { time: s.loaded.bars[s.pos - 1].ts, price: 1.09 }, b: null, color: "#38bdf8" });
  });
  await page.waitForTimeout(150);

  await symbolInput().click();
  await symbolInput().fill("gbpusd");
  await symbolInput().press("Enter");
  await page.waitForTimeout(400);
  // the re-label restarts the replay, so advance a few bars before reading the HUD
  await page.evaluate(() => {
    const s = window.__store.getState();
    for (let i = 0; i < 5; i++) s.step();
  });
  await page.waitForTimeout(350);
  results.relabel = {
    ...(await storeState()),
    box: await symbolInput().inputValue(),
    hud: (await page.locator(".hud-symbol").innerText()).trim(),
    dataChip: (await page.locator(".data-chip").innerText()).trim(),
  };

  // ---- junk input is refused and the box snaps back
  await symbolInput().click();
  await symbolInput().fill("!!");
  await symbolInput().press("Enter");
  await page.waitForTimeout(300);
  results.rejected = {
    ...(await storeState()),
    box: await symbolInput().inputValue(),
  };

  // ---- a file with no symbol in its name keeps the box's symbol
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForTimeout(Number(process.env.WAIT_MS ?? 4000));
  await page.evaluate(() => {
    const s = window.__store.getState();
    for (let i = 0; i < 5; i++) s.step();
  });
  await page.waitForTimeout(350);
  results.fileLoad = {
    ...(await storeState()),
    box: await symbolInput().inputValue(),
    hud: (await page.locator(".hud-symbol").innerText()).trim(),
    dataChip: (await page.locator(".data-chip").innerText()).trim(),
  };

  await page.screenshot({ path: shot });
} catch (e) {
  results.fatal = e.message;
} finally {
  results.consoleErrors = errors;
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.fatal || errors.length > 0) process.exitCode = 1;
