import { describe, expect, it } from "vitest";
import { rayExit } from "../src/lib/shapes";

describe("rayExit", () => {
  it("projects a downward-rising ray to the corner of the plot box", () => {
    expect(rayExit({ x: 0, y: 0 }, { x: 10, y: 10 }, 100, 100)).toEqual({ x: 100, y: 100 });
  });

  it("projects a flat ray to the right edge", () => {
    expect(rayExit({ x: 10, y: 50 }, { x: 60, y: 50 }, 100, 100)).toEqual({ x: 100, y: 50 });
  });

  it("projects a right-to-left ray to the left edge", () => {
    expect(rayExit({ x: 60, y: 50 }, { x: 10, y: 50 }, 100, 100)).toEqual({ x: 0, y: 50 });
  });

  it("stops at the nearest edge for a steep ray", () => {
    expect(rayExit({ x: 50, y: 60 }, { x: 40, y: 20 }, 100, 100)).toEqual({ x: 35, y: 0 });
  });

  it("returns null when the ray has no direction", () => {
    expect(rayExit({ x: 20, y: 20 }, { x: 20, y: 20 }, 100, 100)).toBeNull();
  });

  it("returns null when the second point already left the box", () => {
    expect(rayExit({ x: 0, y: 50 }, { x: 120, y: 50 }, 100, 100)).toBeNull();
  });
});
