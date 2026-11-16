# Contributing to Forex Replay

Thanks for helping. This project is deliberately small at the core and easy to
extend at the edges, so most contributions are a self-contained module plus a
test — you do not need to understand the whole engine.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 104 unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build
```

Node **20.19+** or **22.12+** is required (Vite 7).

## Ground rule: no market data in git

Never commit historical data files (`.json.gz`, `.csv`, `.zip`, broker exports).
The data this project targets comes from [EV Trading Labs](https://evtradelabs.com/data)
and is **not redistributable**. `.gitignore` blocks the common patterns; if you
need a file for a test, generate it inside the test from synthetic bars (see
`src/data/demo.ts` and `tests/helpers.ts`).

## What is easy to add

| Want to add | Where | Test |
|---|---|---|
| An indicator | `src/lib/indicatorRegistry.ts` (define once — menu, editor and renderer all read it) | `tests/indicators.test.ts` |
| A symbol / contract spec | `src/engine/symbols.ts` | `tests/symbols.test.ts` |
| A drawing tool | `src/lib/shapes.ts` + `src/ui/chartDrawings.ts` | `tests/shapes.test.ts` |
| A strategy | `src/strategy/` – implement the `Strategy` interface | — |
| Account/margin/SL/TP behaviour | `src/engine/` | `tests/simulator.test.ts` |

**Keep `src/engine/` and `src/lib/` pure and framework-free.** No React imports,
no DOM, no storage there — that is what keeps it unit-testable and it is the
part of the project that most needs to stay correct.

## Rules the engine must keep

These are the invariants the tests exist to protect. A PR that breaks one needs
an extremely good argument:

- No look-ahead: strategy orders fill on the **next bar's open**; indicator
  values never read future bars.
- Ambiguous bars resolve pessimistically: if SL and TP could both hit inside one
  bar, **SL fills first**.
- Gaps fill at the bar's open, never better than the requested price.
- Buys fill at **ask**, sells at **bid**, and exits are the mirror.
- All money math stays in the engine, not in components.

## Before you open a PR

```bash
npm run typecheck && npm test && npm run build
```

CI runs all three on Node 20 and 22, so a red check means one of them regressed.

- Keep commits focused; say *why* in the message, not just *what*.
- Add a test for behaviour changes. A fix without a regression test will be asked for one.
- UI changes: attach a screenshot. The optional browser smoke tests under
  `scripts/` render one for you:

  ```bash
  npx vite --port 5199 &
  CHROME_PATH=/usr/bin/google-chrome node scripts/smoke.mjs
  ```

  `scripts/*.png` output is gitignored — copy anything you want to show into the
  PR description rather than the repo.

## Reporting bugs

A useful backtest bug report has: the symbol, timeframe, the bar timestamp, the
account settings (leverage, spread source, commission, swap), what you expected
and what happened. If a number looks wrong, the statement row and the journal
line are the two things to include.

## Scope

This is a *research and education* tool. Please do not open PRs that add live
trading, broker API keys, credential storage, or anything that claims
profitability. Model accuracy, honest simulation semantics and usability are
always in scope.
