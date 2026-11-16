/**
 * Headless smoke test for the Forex Replay desk.
 * Uses system Chrome via playwright-core — no browser download required.
 *
 * Run: node scripts/smoke.mjs [baseURL] [screenshotPath]
 */
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://127.0.0.1:5199";
const shot = process.argv[3] ?? "scripts/smoke.png";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const results = {};
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator(".topbar").waitFor({ state: "visible", timeout: 15_000 });
  results.title = await page.title();
  results.canvasBefore = await page.locator(".chart-canvas canvas").count();

  // ---- load demo data
  await page.getByRole("button", { name: "Demo data" }).click();
  await page.waitForTimeout(700);
  results.dataChip = (await page.locator(".data-chip").innerText()).trim();
  results.canvasAfterLoad = await page.locator(".chart-canvas canvas").count();

  // ---- play / pause
  await page.locator(".play-btn").click();
  await page.waitForTimeout(1800);
  await page.locator(".play-btn").click();
  const progress = (await page.locator(".progress-label").innerText()).trim();
  results.progress = progress;

  // ---- market buy
  await page.locator(".buy-btn").click();
  await page.waitForTimeout(400);
  results.positionsTab = (await page.locator(".tab").first().innerText()).trim();
  results.accountEquity = (await page.locator(".account-rows .row").nth(1).innerText()).trim();

  // ---- close it from the positions table
  await page.locator(".link-btn").first().click();
  await page.waitForTimeout(300);

  // ---- statistics after the manual trade
  await page.getByRole("button", { name: /Statistics/ }).click();
  await page.waitForTimeout(300);
  const statsText = await page.locator(".stats-grid").innerText();
  results.statsHasTrades = statsText.toUpperCase().includes("TRADES");

  // ---- strategy backtest
  await page.locator(".replay-strategy select").selectOption("sma");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /Backtest/ }).click();
  await page.waitForTimeout(900);
  results.playbackDone = (await page.locator(".progress-label").innerText()).trim();
  await page.getByRole("button", { name: /Trade history/ }).click();
  await page.waitForTimeout(200);
  results.historyTab = (await page.locator(".tab").nth(2).innerText()).trim();
  const histRows = await page.locator(".tab-body tbody tr").count();
  results.historyRows = histRows;

  await page.getByRole("button", { name: /Statistics/ }).click();
  await page.waitForTimeout(200);
  const statsText2 = await page.locator(".stats-grid").innerText();
  results.statsAfterBacktest = statsText2.split("\n").slice(0, 8).join(" | ");

  await page.screenshot({ path: shot, fullPage: false });
} catch (e) {
  results.fatal = e.message;
} finally {
  results.consoleErrors = errors;
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.fatal || errors.length > 0) process.exitCode = 1;
