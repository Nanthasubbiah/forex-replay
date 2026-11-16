import { describe, expect, it } from "vitest";
import { fibLevels } from "../src/lib/fib";

describe("fibLevels", () => {
  it("interpolates the standard retracement levels", () => {
    const levels = fibLevels(1.1, 1.2);
    expect(levels).toHaveLength(7);
    expect(levels[0]).toMatchObject({ ratio: 0, label: "0%" });
    expect(levels[0].price).toBeCloseTo(1.1);
    expect(levels[3]).toMatchObject({ ratio: 0.5, label: "50.0%" });
    expect(levels[3].price).toBeCloseTo(1.15);
    expect(levels[4].price).toBeCloseTo(1.1618);
    expect(levels[5].price).toBeCloseTo(1.1786);
    expect(levels[6]).toMatchObject({ ratio: 1, label: "100%" });
    expect(levels[6].price).toBeCloseTo(1.2);
  });

  it("only highlights 61.8% as the golden level", () => {
    const levels = fibLevels(1.1, 1.2);
    expect(levels.filter((l) => l.golden).map((l) => l.label)).toEqual(["61.8%"]);
  });

  it("works for downward swings", () => {
    const levels = fibLevels(1.2, 1.1);
    expect(levels[0].price).toBeCloseTo(1.2);
    expect(levels[3].price).toBeCloseTo(1.15);
    expect(levels[6].price).toBeCloseTo(1.1);
  });

  it("flattens when both anchors are equal", () => {
    const levels = fibLevels(1.15, 1.15);
    expect(levels.every((l) => l.price === 1.15)).toBe(true);
  });
});

import {
  addLevel,
  defaultFibLevels,
  distToSegment,
  removeLevel,
  toggleLevel,
} from "../src/lib/fib";

describe("fib drawing helpers", () => {
  it("creates the default level set enabled", () => {
    const levels = defaultFibLevels();
    expect(levels).toHaveLength(7);
    expect(levels.every((l) => l.enabled)).toBe(true);
  });

  it("adds custom levels sorted and rejects duplicates/invalid input", () => {
    const withExt = addLevel(defaultFibLevels(), 127.2);
    expect(withExt).not.toBeNull();
    expect(withExt!.at(-1)).toEqual({ ratio: 1.272, enabled: true });
    expect(withExt).toHaveLength(8);
    expect(addLevel(defaultFibLevels(), 61.8)).toBeNull();
    expect(addLevel(defaultFibLevels(), -5)).toBeNull();
    expect(addLevel(defaultFibLevels(), 5000)).toBeNull();
  });

  it("toggles and removes levels", () => {
    const toggled = toggleLevel(defaultFibLevels(), 0.5);
    expect(toggled.find((l) => l.ratio === 0.5)!.enabled).toBe(false);
    expect(toggled).toHaveLength(7);
    const removed = removeLevel(defaultFibLevels(), 0.5);
    expect(removed.some((l) => l.ratio === 0.5)).toBe(false);
    expect(removed).toHaveLength(6);
  });

  it("computes point-to-segment distance", () => {
    expect(distToSegment(0, 5, 0, 0, 10, 10)).toBeCloseTo(Math.SQRT1_2 * 5);
    expect(distToSegment(-3, 0, 0, 0, 10, 10)).toBeCloseTo(Math.hypot(3, 0));
    expect(distToSegment(0, 0, 0, 0, 0, 0)).toBeCloseTo(0);
  });
});

import { FIB_COLOR_BY_KIND, fibLevelsFor } from "../src/lib/fib";

describe("fib tool kinds", () => {
  it("retracement has 7 levels", () => {
    expect(fibLevelsFor("retracement")).toHaveLength(7);
  });

  it("extension adds 127.2 and 161.8 projections", () => {
    const levels = fibLevelsFor("extension");
    expect(levels).toHaveLength(9);
    expect(levels.at(-2)).toEqual({ ratio: 1.272, enabled: true });
    expect(levels.at(-1)).toEqual({ ratio: 1.618, enabled: true });
  });

  it("uses distinct default colours per kind", () => {
    expect(FIB_COLOR_BY_KIND.retracement).not.toBe(FIB_COLOR_BY_KIND.extension);
  });
});
