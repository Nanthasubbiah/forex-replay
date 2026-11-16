# ForexReplay — MT4-style backtesting desk (browser, open source)

A free, self-hosted backtesting workspace that behaves like the MT4 **Strategy Tester in
visual mode**: load historical data, press play, and trade against a real *account* —
balance, equity, margin, free margin, stop-out, swap, commission, pending orders and a
full trade statement. Everything runs in your browser; your data never leaves the machine.

> Not affiliated with MetaQuotes. It re-implements MT4 *account semantics*, not MQL4/`.ex4`.

---

## Why this exists

The paid market already sells "MT4 backtesters" (Forex Tester, FX Blue, TradingView replay).
What was missing from open source was the *experience*: a free, local, browser-based desk
where you upload broker-grade history and trade/backtest under MT4 account rules.

**Data**: this project is built around free downloads from
[EV Trading Labs](https://evtradelabs.com/data) — 19 symbols (FX majors, XAU/XAG, indices,
crypto, oil), M1→D1, 2003–2026, aggregated from Dukascopy **ticks with bid *and* ask**
prices. M5+ is free; M1 and the current year need a free account on their site.
**Do not redistribute their files** — download them yourself and load them into the app.

---

## Features (Phase 1)

### MT4 account model
| Feature | Status |
|---|---|
| Balance / Equity / Margin / Free margin / Margin level | ✅ |
| Lot sizing with per-symbol contract size & pip value | ✅ |
| Market orders (fill at ask for buys, bid for sells) | ✅ |
| Pending: Buy Limit / Sell Limit / Buy Stop / Sell Stop | ✅ |
| SL / TP (intrabar, gap-aware, conservative SL-first) | ✅ |
| OCO pending groups | ✅ |
| Swap per lot per night, triple swap on Wednesday | ✅ |
| Commission per lot per side | ✅ |
| Stop-out when margin level < X% (worst position first) | ✅ |
| Trade history → statement-style report | ✅ |
| Slippage (configurable, pips) | ✅ |

### Trading desk
- Pending orders are drawn on the chart as dashed lines labelled `BUY STOP #12` etc.;
  when triggered they are replaced by the `BUY #12 0.10` position line (same for sells).
- Right-click any row in *Positions* to **modify SL/TP** or **close**, and in *Open orders*
  to **modify** (trigger price / SL / TP) or **cancel**. All validation is done by the engine
  and errors appear as toasts.
- **Fibonacci retracement tool**: press `Fibonacci`, then click the swing start and end on
  the chart. The tool draws:
  - a dotted diagonal between the two clicked points,
  - horizontal level segments **that span only between those two points** (not the whole
    chart), at 0 / 23.6 / 38.2 / 50 / 61.8 / 78.6 / 100% (61.8% highlighted), labels showing
    each level's price.

  **Drag** anywhere on the drawing (diagonal, level lines or anchor handles) to move the
  whole tool. **Right-click** it to open the editor, where you can show/hide any level,
  remove a level, add a custom level (e.g. 127.2%), or change the colour. `Esc` cancels a
  drawing in progress; `Clear` removes all fib tools.

### Replay & analysis
- Bar-by-bar replay with play/pause/step, 1×–400× speed, progress + UTC timestamp.
- Candlestick chart (lightweight-charts), volume, trade markers, live SL/TP/entry lines.
- Statistics: net profit, return %, profit factor, win rate, expectancy, avg win/loss,
  max drawdown (abs & %), streaks, commission, swap, monthly P/L table.
- Journal of every fill, pending trigger, OCO cancel, swap charge and stop-out.

### Strategy API (TypeScript, runs in-browser)
```ts
import type { Strategy, StrategyContext } from "./strategy/api";

export class MyEdge implements Strategy {
  name = "My edge";
  description = "Example";
  onBar(ctx: StrategyContext) {
    if (ctx.history.sma(20)! > ctx.history.sma(50)!) {
      if (!ctx.positions.some((p) => p.side === "buy")) {
        ctx.buy(0.1, { sl: ctx.bar.bid.c - 0.002, tp: ctx.bar.bid.c + 0.004 });
      }
    }
  }
}
```
Market orders placed from a strategy fill on the **next bar's open**, which makes
look-ahead bias structurally impossible. Two built-in runs: `Manual` or `SMA 20/50`
(press **Backtest ▸** to run it to completion).

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 (port may vary)
```

1. **Demo data** → loads a synthetic EURUSD M5 year (6,000 bars) instantly.
2. or **Load data** → pick your downloaded `SYMBOL_TF_YEAR.json.gz` (or a CSV export).
3. Press ▶ Play / ⏭ Step, then trade from the order panel.
4. See the *Statistics* tab for the statement.

### Supported data files
| Format | Notes |
|---|---|
| evtradelabs `.json.gz` | The normal download. Contains `ts` + bid `o,h,l,c` + ask `ao,ah,al,ac` + `v`. **Preferred.** |
| JSON array | Same schema, plain `.json`. |
| CSV | Header aliases: `time/date/timestamp`, `open/high/low/close`, optional `ao/ah/al/ac`, `volume`. Also parses MT4's `Date;Time;Open…` exports (dates read as UTC). |
| Bid-only files | Set *"Bid-only spread (pips)"* in Account settings; the spread is synthesised. |
| ZIP | Not yet supported — unzip first. |

Symbol is inferred from the filename (`AUDUSD_M5_2025.json.gz` → `AUDUSD`), otherwise EURUSD.

---

## Simulation semantics (read this before trusting a number)

- **Bar-level simulation** (like MT4's "M1 OHLC" mode). No tick-level modelling yet.
- Prices come from the file's own bid/ask; spreads and gaps are real, not cosmetic.
- Buys execute at ask, sells at bid; profitable exits are the mirror.
- If a bar's high and low could have hit both SL and TP, **SL is assumed to hit first**
  (worst case for the trader). Gaps fill at the bar's open, never better than requested.
- Margin: `lots × contractSize × price / leverage` in USD, with quote→USD conversion for
  JPY/GBP/EUR-quoted instruments. The conversion table is editable per-session in the
  simulator config when a needed pair isn't loaded (Phase 2 adds multi-symbol books).
- Stop-out closes the largest-losing positions first until margin level ≥ threshold.
- Swap is applied per UTC day rollover; Wednesday is triple. Defaults per symbol are
  placeholders — tune them for your broker.
- Strategy orders are next-bar-open; manual orders fill at the current (last processed)
  bar's close, mirroring MT4 instant execution.

---

## Architecture

```
src/
  engine/      pure, framework-free simulation core (unit-tested, 45 tests)
    symbols.ts   contract specs for all 19 evtradelabs symbols
    account.ts   pip value, margin, conversion, P/L
    simulator.ts order lifecycle, SL/TP, stop-out, swap, strategy hooks
    stats.ts     statement statistics + monthly buckets
  data/        evtradelabs JSON.gz / CSV parsers (gzip via DecompressionStream) + demo
  strategy/    Strategy API types + built-in SMA cross
  ui/          React terminal: chart, account, order panel, replay, tabs
  store.ts     zustand orchestration (replay clock, settings, toasts)
tests/         vitest: account math, fills, pendings, stop-out, swap, stats, parsers
scripts/       headless Chrome smoke tests (playwright-core, system chrome — no download)
```

### Verify it
```bash
npm test              # 45 engine/parser tests (vitest)
npm run build         # tsc --noEmit + vite build

# browser smoke tests (needs a dev server on 5199 and /usr/bin/google-chrome):
npx vite --port 5199 --strictPort &
node scripts/smoke.mjs           # demo data, play, trade, strategy backtest
node scripts/smoke-realdata.mjs  # a real evtradelabs file through the UI parser
node scripts/smoke-actions.mjs   # pending lines, right-click modify/close, Fibonacci tool
```

---

## Roadmap

- Phase 2: multi-symbol portfolio replay, equity curve chart, slippage model presets,
  optimization sweeps over strategy params, prop-firm rules (daily loss / max DD),
  HTML/CSV statement export, trade list import/export, M1→tick builder.
- Phase 3: strategy marketplace patterns (params UI), Python strategy bridge, plugin API.

## License

MIT — see [LICENSE](LICENSE). Historical data remains the property of its provider
([EV Trading Labs](https://evtradelabs.com/data)); this project distributes no market data.

## Disclaimer

Simulated results are not indicative of future performance. This tool is for research and
education. No warranty; do not use it to judge live trading risk without independent
verification of your broker's contract specs, spreads, swaps and commissions.
