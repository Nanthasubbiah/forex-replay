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
