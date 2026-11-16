import { describe, expect, it } from "vitest";
import {
  computeMarginLevel,
  grossPnlUsd,
  marginUsd,
  pipValueUsd,
  usdRate,
} from "../src/engine/account";
import { getSymbolSpec } from "../src/engine/symbols";

const book = (entries: Record<string, number>): Map<string, number> => new Map(Object.entries(entries));
const EURUSD = getSymbolSpec("EURUSD");
const USDJPY = getSymbolSpec("USDJPY");
const EURGBP = getSymbolSpec("EURGBP");

describe("usdRate", () => {
  it("resolves USD directly", () => {
    expect(usdRate("USD", book({}))).toBe(1);
  });

  it("resolves direct and inverse pairs", () => {
    expect(usdRate("EUR", book({ EURUSD: 1.09 }))).toBeCloseTo(1.09);
    expect(usdRate("JPY", book({ USDJPY: 138 }))).toBeCloseTo(1 / 138);
  });

  it("prefers explicit overrides for unloaded currencies", () => {
    const overrides = { get: (c: string) => (c === "GBP" ? 1.27 : undefined) };
    expect(usdRate("GBP", book({}), overrides)).toBeCloseTo(1.27);
  });
});

describe("pipValueUsd", () => {
  it("EURUSD pip = $10 per lot", () => {
    expect(pipValueUsd(EURUSD, 1.1, book({ EURUSD: 1.1 }))).toBeCloseTo(10);
  });

  it("USDJPY pip converts through the quote rate", () => {
    expect(pipValueUsd(USDJPY, 138, book({ USDJPY: 138 }))).toBeCloseTo(1000 / 138);
  });

  it("cross pair pip converts via the quote currency", () => {
    expect(pipValueUsd(EURGBP, 0.85, book({ GBPUSD: 1.27 }))).toBeCloseTo(12.7);
  });
});

describe("marginUsd", () => {
  it("EURUSD 1 lot at 1:100", () => {
    const m = marginUsd(EURUSD, 1, 1.0856, 100, book({ EURUSD: 1.0856 }));
    expect(m).toBeCloseTo(1085.6);
  });

  it("USD-base pairs use the base notional", () => {
    const m = marginUsd(USDJPY, 1, 138, 100, book({ USDJPY: 138 }));
    expect(m).toBeCloseTo(1000);
  });

  it("cross pairs convert quote to USD", () => {
    const m = marginUsd(EURGBP, 1, 0.85, 100, book({ GBPUSD: 1.27 }));
    expect(m).toBeCloseTo((100_000 * 0.85 * 1.27) / 100);
  });
});

describe("grossPnlUsd", () => {
  it("long EURUSD +10 pips = +$100", () => {
    const pnl = grossPnlUsd("buy", EURUSD, 1, 1.1, 1.101, book({ EURUSD: 1.101 }));
    expect(pnl).toBeCloseTo(100);
  });

  it("short EURUSD -10 pips = -$100", () => {
    const pnl = grossPnlUsd("sell", EURUSD, 1, 1.1, 1.101, book({ EURUSD: 1.101 }));
    expect(pnl).toBeCloseTo(-100);
  });

  it("USDJPY profit is converted from JPY", () => {
    const pnl = grossPnlUsd("buy", USDJPY, 1, 138, 138.5, book({ USDJPY: 138.5 }));
    expect(pnl).toBeCloseTo(50_000 / 138.5);
  });
});

describe("computeMarginLevel", () => {
  it("is infinite with no margin", () => {
    expect(computeMarginLevel(1000, 0)).toBe(Number.POSITIVE_INFINITY);
  });
  it("computes equity/margin * 100", () => {
    expect(computeMarginLevel(500, 1000)).toBeCloseTo(50);
  });
});
