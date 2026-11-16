/**
 * Real-data smoke test: loads a genuine evtradelabs download into the browser
 * through the file input and verifies parsing, replay and trading.
 *
 * Run: node scripts/smoke-realdata.mjs [baseURL] [file]
 */
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://127.0.0.1:5199";
const file = process.argv[3] ?? "fixtures/audusd_m5_2025.json.gz";
const shot = "scripts/smoke-real.png";

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

  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForTimeout(1500);

  results.dataChip = (await page.locator(".data-chip").innerText()).trim();

  // play a bit and pause
  await page.locator(".play-btn").click();
  await page.waitForTimeout(1200);
  await page.locator(".play-btn").click();
  results.hud = (await page.locator(".chart-hud").innerText()).trim();
  results.progress = (await page.locator(".progress-label").innerText()).trim();
  results.bidAsk = (await page.locator(".price-strip").innerText()).trim().replace(/\n/g, " ");

  // trade with real prices
  await page.locator(".buy-btn").click();
  await page.waitForTimeout(300);
  results.positionsTab = (await page.locator(".tab").first().innerText()).replace(/\n/g, " ");

  // close and verify history
  await page.locator(".link-btn").first().click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /Trade history/ }).click();
  await page.waitForTimeout(200);
  results.historyTab = (await page.locator(".tab").nth(2).innerText()).replace(/\n/g, " ");

  // step through a few more bars to prove replay works on real data
  await page.getByRole("button", { name: /Positions/ }).click();
  await page.locator(".icon-btn").nth(1).click(); // step
  await page.waitForTimeout(200);
  results.afterStep = (await page.locator(".progress-label").innerText()).trim();

  await page.screenshot({ path: shot });
} catch (e) {
  results.fatal = e.message;
} finally {
  results.consoleErrors = errors;
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.fatal || errors.length > 0) process.exitCode = 1;
