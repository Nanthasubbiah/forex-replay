/**
 * Interaction smoke test: pending-order lines, right-click modify/close, Fibonacci tool.
 *
 * Run: node scripts/smoke-actions.mjs [baseURL]
 */
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://127.0.0.1:5199";
const shot = "scripts/smoke-actions.png";

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
const tabCount = async (idx) => {
  const text = await page.locator(".tab").nth(idx).innerText();
  const m = text.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
};

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator(".topbar").waitFor({ state: "visible", timeout: 15_000 });

  // ---- demo + replay
  await page.getByRole("button", { name: "Demo data" }).click();
  await page.waitForTimeout(600);
  await page.locator(".play-btn").click();
  await page.waitForTimeout(900);
  await page.locator(".play-btn").click();

  const ask = (() => {
    const m = page.locator(".price-strip b");
    return m.last().innerText();
  })();
  const askPrice = Number(await ask);
  results.askPrice = askPrice;

  // ---- place a pending buy stop 1.2 pips above the ask
  await page.locator(".pending-form select").selectOption("buy_stop");
  const trigger = (askPrice + 0.00012).toFixed(5);
  await page.locator(".pending-form input[type=number]").first().fill(trigger);
  await page.getByRole("button", { name: "Place pending order" }).click();
  await page.waitForTimeout(300);
  results.ordersAfterPlace = await tabCount(1);
  await page.screenshot({ path: "scripts/smoke-pending.png" });

  results.journalEvents = await tabCount(4);

  // ---- right-click the pending row -> modify dialog
  await page.getByRole("button", { name: /Open orders/ }).click();
  await page.waitForTimeout(200);
  await page.locator(".tab-body tbody tr").first().click({ button: "right" });
  await page.waitForTimeout(200);
  results.ctxMenuVisible = await page.locator(".ctx-menu").isVisible();
  results.ctxItems = await page.locator(".ctx-item").allInnerTexts();
  await page.getByRole("button", { name: "Modify order…" }).click();
  await page.waitForTimeout(200);
  results.modalTitle = (await page.locator(".modal h3").innerText()).trim();
  const pendingInputs = page.locator(".modal input[type=number]");
  await pendingInputs.nth(2).fill((askPrice + 0.02).toFixed(5)); // TP above ask, will not trigger first
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(300);
  results.toastAfterModify = (await page.locator(".toast").innerText()).trim();
  results.ordersAfterModify = await tabCount(1);

  // ---- step until the pending triggers, then confirm it became a position
  await page.getByRole("button", { name: /Positions/ }).click();
  for (let i = 0; i < 60; i++) {
    if ((await tabCount(0)) > 0) break;
    await page.locator(".icon-btn").nth(1).click();
    await page.waitForTimeout(25);
  }
  results.positionsAfterTrigger = await tabCount(0);
  results.ordersAfterTrigger = await tabCount(1);

  // ---- open a manual position and modify its SL through the context menu
  await page.getByRole("button", { name: /Positions/ }).click();
  await page.locator(".buy-btn").click();
  await page.waitForTimeout(300);
  results.positionsAfterBuy = await tabCount(0);

  const row = page.locator(".tab-body tbody tr").first();
  const cells = await row.locator("td").allInnerTexts();
  const openPrice = Number(cells[4]);
  await row.click({ button: "right" });
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /Modify SL/ }).click();
  await page.waitForTimeout(200);
  const slInput = page.locator(".modal input[type=number]").nth(0);
  await slInput.fill((openPrice - 0.01).toFixed(5));
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(300);
  const cellsAfter = await page.locator(".tab-body tbody tr").first().locator("td").allInnerTexts();
  results.slShownAfterModify = cellsAfter[6];
  results.toastAfterSl = (await page.locator(".toast").innerText()).trim();

  // ---- close it via context menu
  await page.locator(".tab-body tbody tr").first().click({ button: "right" });
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Close position" }).click();
  await page.waitForTimeout(300);
  results.positionsAfterContextClose = await tabCount(0);

  // ---- Fibonacci tool: two chart clicks
  await page.locator(".tool-btn").first().click();
  const box = await page.locator(".chart-canvas").boundingBox();
  const p1 = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
  const p2 = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.55 };
  await page.mouse.click(p1.x, p1.y);
  await page.waitForTimeout(120);
  results.fibHintAfterFirstClick = await page.locator(".tool-hint").innerText();
  await page.mouse.click(p2.x, p2.y);
  await page.waitForTimeout(250);
  results.fibChip = (await page.locator(".tool-chip").innerText()).trim();
  await page.screenshot({ path: "scripts/smoke-fib.png" });

  // ---- right-click the drawing (anchor) -> editor
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  await page.mouse.click(p1.x, p1.y, { button: "right" });
  await page.waitForTimeout(200);
  results.fibMenuItems = (await page.locator(".ctx-item").allInnerTexts()).map((t) => t.trim());
  await page.getByRole("button", { name: "Edit levels & colour…" }).click();
  await page.waitForTimeout(200);
  results.fibEditorOpen = await page.locator(".fib-editor").isVisible();
  results.fibRowsBefore = await page.locator(".fib-row").count();

  // toggle the 23.6% level off, remove 78.6%, add a 127.2% level, pick a colour
  await page.locator(".fib-row").nth(1).locator('input[type="checkbox"]').click();
  await page.locator(".fib-row").nth(5).locator(".link-btn").click();
  await page.locator(".fib-add input").fill("127.2");
  await page.locator(".fib-add button").click();
  await page.locator(".fib-swatch").nth(1).click();
  await page.waitForTimeout(150);
  results.fibRowsAfter = await page.locator(".fib-row").count();
  results.fibColors = await page.locator(".fib-swatch.active").evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(200);
  results.fibEditorClosed = !(await page.locator(".fib-editor").isVisible());
  results.fibChipAfterEdit = (await page.locator(".tool-chip").innerText()).trim();

  // ---- drag the whole tool down-right
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 70, mid.y + 50, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  results.fibChipAfterDrag = (await page.locator(".tool-chip").innerText()).trim();

  await page.screenshot({ path: shot });
} catch (e) {
  results.fatal = e.message;
} finally {
  results.consoleErrors = errors;
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.fatal || errors.length > 0) process.exitCode = 1;
