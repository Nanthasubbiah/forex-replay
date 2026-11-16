/**
 * Simple chart line tools (vertical, horizontal, trend).
 *
 * Points are stored in chart coordinates (UTC bar time + price) so the tools
 * survive panning, zooming and replay stepping; the canvas overlay converts
 * them to pixels on every frame.
 */

export type ShapeKind = "vertical" | "horizontal" | "trend";

export type ShapeToolKind = ShapeKind;

export interface ShapePoint {
  /** Bar timestamp (seconds, UTC). */
  time: number;
  price: number;
}

export interface DrawingShape {
  id: number;
  kind: ShapeKind;
  /** Anchor for every shape; the click point for one-point lines. */
  a: ShapePoint;
  /** Second anchor — only trend lines use it. */
  b: ShapePoint | null;
  color: string;
}

export const SHAPE_COLOR_BY_KIND: Record<ShapeKind, string> = {
  vertical: "#a78bfa",
  horizontal: "#38bdf8",
  trend: "#f59e0b",
};

export const SHAPE_LABEL: Record<ShapeKind, string> = {
  vertical: "Vertical line",
  horizontal: "Horizontal line",
  trend: "Trend line",
};

export const SHAPE_COLOR_PRESETS = ["#a78bfa", "#38bdf8", "#f59e0b", "#34d399", "#f87171", "#e5e7eb"];

export interface ScreenPoint {
  x: number;
  y: number;
}

const RAY_EPSILON = 1e-6;

/**
 * Screen point where the ray that starts at `from` and passes through `to`
 * leaves the `width` × `height` plot box.
 *
 * Trend lines use this to run on past their second point up to the edge of the
 * chart window instead of stopping in mid-air. Returns null when the ray has no
 * length or points away from every edge (for example when `to` already sits
 * outside the box on the side the ray travels towards).
 */
export function rayExit(
  from: ScreenPoint,
  to: ScreenPoint,
  width: number,
  height: number,
): ScreenPoint | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < RAY_EPSILON && Math.abs(dy) < RAY_EPSILON) return null;

  let nearest = Infinity;
  const consider = (t: number) => {
    if (t > RAY_EPSILON && t < nearest) nearest = t;
  };
  // Horizontal exit: only in the direction the ray actually travels.
  if (dx > RAY_EPSILON) consider((width - to.x) / dx);
  else if (dx < -RAY_EPSILON) consider(-to.x / dx);
  // Vertical exit, same idea.
  if (dy > RAY_EPSILON) consider((height - to.y) / dy);
  else if (dy < -RAY_EPSILON) consider(-to.y / dy);
  if (!Number.isFinite(nearest)) return null;

  return {
    x: Math.max(0, Math.min(width, to.x + dx * nearest)),
    y: Math.max(0, Math.min(height, to.y + dy * nearest)),
  };
}
