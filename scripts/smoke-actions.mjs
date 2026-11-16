/**
 * Interaction smoke test: pending-order lines, right-click modify/close, Fibonacci tool.
 *
 * Run: node scripts/smoke-actions.mjs [baseURL]
 */
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://127.0.0.1:5199";
const shot = "scripts/smoke-actions.png";

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

  // ---- Fibonacci via the top toolbar (dropdown: retracement / extension)
  const box = await page.locator(".chart-canvas").boundingBox();
  const stGet = () => page.evaluate(() => {
    const s = window.__store.getState();
    return { fibs: s.fibs, tool: s.fibTool, anchor: s.fibAnchor };
  });
  const toPage = async (time, price) => {
    const pt = await page.evaluate(({ time, price }) => {
      const h = window.__chartTest;
      return { x: h.toX(time), y: h.toY(price) };
    }, { time, price });
    return { x: box.x + pt.x, y: box.y + pt.y };
  };

  await page.locator(".toolbar-tab").first().click();
  results.toolbarMenu = (await page.locator(".toolbar-menu").innerText()).replace(/\n/g, " | ");
  await page.getByRole("menuitem", { name: /^Retracement/ }).click();
  results.fibHint1 = await page.locator(".tool-hint").innerText();

  const p1 = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
  const p2 = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.55 };
  await page.mouse.click(p1.x, p1.y);
  await page.waitForTimeout(120);
  results.fibHint2 = await page.locator(".tool-hint").innerText();
  await page.mouse.click(p2.x, p2.y);
  await page.waitForTimeout(250);
  let st = await stGet();
  results.fibCreated = {
    count: st.fibs.length,
    levels: st.fibs[0].levels.length,
    color: st.fibs[0].color,
    toolCleared: st.tool === null,
  };
  await page.screenshot({ path: "scripts/smoke-fib.png" });

  const fib0 = st.fibs[0];
  const priceAt = (r) => fib0.a.price + (fib0.b.price - fib0.a.price) * r;
  const spanTime = fib0.a.time; // a real bar time inside the drawn span

  // ---- right-click the 61.8% level line -> quick hide
  const lvl615 = await toPage(spanTime, priceAt(0.618));
  await page.mouse.click(lvl615.x, lvl615.y, { button: "right" });
  await page.waitForTimeout(200);
  results.fibLevelMenuItems = (await page.locator(".ctx-item").allInnerTexts()).map((t) => t.trim());
  await page.getByRole("button", { name: /Hide 61.8% level/ }).click();
  await page.waitForTimeout(200);
  st = await stGet();
  results.fib618Hidden = st.fibs[0].levels.find((l) => Math.abs(l.ratio - 0.618) < 1e-9).enabled === false;

  // ---- drag the whole tool from the 50% level line
  const pct50 = await toPage(spanTime, priceAt(0.5));
  await page.mouse.move(pct50.x, pct50.y);
  await page.mouse.down();
  await page.mouse.move(pct50.x + 60, pct50.y + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const stMove = await stGet();
  const fib1 = stMove.fibs[0];
  const dA = fib1.a.price - fib0.a.price;
  const dB = fib1.b.price - fib0.b.price;
  results.wholeDrag = {
    bothPricesMoved: Math.abs(dA) > 0.0001 && Math.abs(dB) > 0.0001,
    equalDeltas: Math.abs(dA - dB) < 1e-9,
    timesShifted: fib1.a.time !== fib0.a.time && fib1.b.time !== fib0.b.time,
  };

  // ---- drag anchor A only (resize the swing)
  const anchorA = await toPage(fib1.a.time, fib1.a.price);
  await page.mouse.move(anchorA.x, anchorA.y);
  await page.mouse.down();
  await page.mouse.move(anchorA.x + 55, anchorA.y + 35, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const stAnchor = await stGet();
  const fib2 = stAnchor.fibs[0];
  results.anchorDrag = {
    aPriceChanged: fib2.a.price !== fib1.a.price,
    bUnchanged: fib2.b.price === fib1.b.price && fib2.b.time === fib1.b.time,
  };

  // ---- editor on the retracement fib (edit opens via right-click on its body)
  const fibNow = stAnchor.fibs[0];
  const bodyPt = await toPage(fibNow.a.time, fibNow.a.price + (fibNow.b.price - fibNow.a.price) * 0.5);
  await page.mouse.click(bodyPt.x, bodyPt.y, { button: "right" });
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Edit levels & colour…" }).click();
  await page.waitForTimeout(200);
  results.fibRowsBefore = await page.locator(".fib-row").count();
  await page.locator(".fib-row").nth(1).locator('input[type="checkbox"]').click();
  await page.locator(".fib-row").nth(5).locator(".link-btn").click();
  await page.locator(".fib-add input").fill("127.2");
  await page.locator(".fib-add button").click();
  await page.locator(".fib-swatch").nth(1).click();
  await page.waitForTimeout(150);
  results.fibColors = await page.locator(".fib-swatch.active").evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(200);
  st = await stGet();
  results.fibAfterEdit = {
    count: st.fibs.length,
    levels: st.fibs[0].levels.length,
    has127: st.fibs[0].levels.some((l) => Math.abs(l.ratio - 1.272) < 1e-9),
    level23enabled: st.fibs[0].levels.find((l) => Math.abs(l.ratio - 0.236) < 1e-9)?.enabled,
    has786: st.fibs[0].levels.some((l) => Math.abs(l.ratio - 0.786) < 1e-9),
    color: st.fibs[0].color,
  };

  // ---- Extension tool (adds 127.2 / 161.8 directly)
  await page.locator(".toolbar-tab").first().click();
  await page.getByRole("menuitem", { name: /^Extension/ }).click();
  await page.mouse.click(p1.x, p1.y);
  await page.waitForTimeout(100);
  await page.mouse.click(p2.x, p2.y);
  await page.waitForTimeout(250);
  st = await stGet();
  results.fibExtension = {
    count: st.fibs.length,
    levels: st.fibs[1]?.levels.length,
    color: st.fibs[1]?.color,
    has1618: st.fibs[1]?.levels.some((l) => Math.abs(l.ratio - 1.618) < 1e-9) ?? false,
    toolCleared: st.tool === null,
  };
  results.fibChip = (await page.locator(".tool-chip").innerText()).trim();

  await page.screenshot({ path: shot });
} catch (e) {
  results.fatal = e.message;
} finally {
  results.consoleErrors = errors;
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.fatal || errors.length > 0) process.exitCode = 1;
