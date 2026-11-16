import { describe, expect, it } from "vitest";
import { fmtPips, fmtSpan, measureStats, type MeasurePoint } from "../src/lib/measure";
import { getSymbolSpec } from "../src/engine/symbols";

const T0 = Date.UTC(2025, 0, 6, 0, 0, 0) / 1000;

function point(index: number, price: number, minutes = 5): MeasurePoint {
  return { index, time: T0 + index * minutes * 60, price };
}

describe("measureStats", () => {
  it("reads pips and points across a EURUSD span", () => {
    const stats = measureStats(point(0, 1.1), point(42, 1.10424), getSymbolSpec("EURUSD"));
    expect(stats.bars).toBe(42);
    expect(stats.seconds).toBe(42 * 5 * 60);
    expect(stats.pips).toBeCloseTo(42.4, 6);
    expect(stats.points).toBe(424);
    expect(stats.direction).toBe("up");
  });

  it("uses the symbol pip size for JPY pairs and metals", () => {
    const jpy = measureStats(point(0, 150.1), point(10, 150.35), getSymbolSpec("USDJPY"));
    expect(jpy.pips).toBeCloseTo(25, 6);
    expect(jpy.points).toBe(250);

    const gold = measureStats(point(0, 2400), point(3, 2401.5), getSymbolSpec("XAUUSD"));
    expect(gold.pips).toBeCloseTo(15, 6);
    expect(gold.points).toBe(150);
  });

  it("is direction-agnostic for the bar count but keeps the signed price move", () => {
    const stats = measureStats(point(30, 1.11), point(0, 1.1), getSymbolSpec("EURUSD"));
    expect(stats.bars).toBe(30);
    expect(stats.seconds).toBe(-30 * 5 * 60);
    expect(stats.direction).toBe("down");
    expect(stats.pips).toBeCloseTo(100, 6);
  });

  it("reports a flat span", () => {
    const stats = measureStats(point(5, 1.1), point(5, 1.1), getSymbolSpec("EURUSD"));
    expect(stats.bars).toBe(0);
    expect(stats.pips).toBe(0);
    expect(stats.direction).toBe("flat");
  });
});

describe("measure formatting", () => {
  it("formats time spans from seconds to days", () => {
    expect(fmtSpan(45)).toBe("45s");
    expect(fmtSpan(12 * 60)).toBe("12m");
    expect(fmtSpan(3 * 3600 + 30 * 60)).toBe("3h 30m");
    expect(fmtSpan(2 * 86_400 + 4 * 3600)).toBe("2d 4h");
  });

  it("trims fractional pips", () => {
    expect(fmtPips(42)).toBe("42");
    expect(fmtPips(42.4)).toBe("42.4");
    expect(fmtPips(42.44)).toBe("42.4");
  });
});
