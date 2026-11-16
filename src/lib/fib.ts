/** Standard Fibonacci retracement ratios (0% = swing start, 100% = swing end). */
export const RETRACEMENT_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export interface FibLevel {
  /** 0..1 ratio of the retracement. */
  ratio: number;
  /** Price at this level. */
  price: number;
  /** Human label, e.g. `61.8%`. */
  label: string;
  /** Golden-ratio level (61.8) gets the highlight colour. */
  golden: boolean;
}

export function ratioLabel(ratio: number): string {
  if (ratio === 0) return "0%";
  if (ratio === 1) return "100%";
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Price at `ratio` between the two anchors (works for up and down swings). */
export function fibPrice(priceA: number, priceB: number, ratio: number): number {
  return priceA + (priceB - priceA) * ratio;
}

/**
 * Compute retracement levels between two swing prices.
 * `priceA` is the 0% anchor and `priceB` the 100% anchor; levels interpolate
 * linearly between them (works for both up and down swings).
 */
export function fibLevels(priceA: number, priceB: number): FibLevel[] {
  return RETRACEMENT_RATIOS.map((ratio) => ({
    ratio,
    price: fibPrice(priceA, priceB, ratio),
    label: ratioLabel(ratio),
    golden: ratio === 0.618,
  }));
}

// ------------------------------------------------------------- drawing model

export interface FibLevelState {
  ratio: number;
  enabled: boolean;
}

export interface FibAnchor {
  /** Bar timestamp (seconds, UTC). */
  time: number;
  price: number;
}

export interface FibDrawing {
  id: number;
  a: FibAnchor;
  b: FibAnchor;
  color: string;
  levels: FibLevelState[];
}

export const DEFAULT_FIB_COLOR = "#22d3ee";
export const FIB_COLOR_PRESETS = ["#22d3ee", "#f59e0b", "#a78bfa", "#34d399", "#f87171", "#e5e7eb"];

/** Extension projection ratios drawn on top of the retracement set. */
export const EXTENSION_RATIOS = [1.272, 1.618] as const;

export type FibToolKind = "retracement" | "extension";

export const FIB_COLOR_BY_KIND: Record<FibToolKind, string> = {
  retracement: DEFAULT_FIB_COLOR,
  extension: "#a78bfa",
};

/** Default level set for a freshly drawn tool of the given kind. */
export function fibLevelsFor(kind: FibToolKind): FibLevelState[] {
  const ratios: number[] = [...RETRACEMENT_RATIOS];
  if (kind === "extension") ratios.push(...EXTENSION_RATIOS);
  return ratios.map((ratio) => ({ ratio, enabled: true }));
}

export function defaultFibLevels(): FibLevelState[] {
  return fibLevelsFor("retracement");
}

export function toggleLevel(levels: FibLevelState[], ratio: number): FibLevelState[] {
  return levels.map((l) => (l.ratio === ratio ? { ...l, enabled: !l.enabled } : l));
}

export function removeLevel(levels: FibLevelState[], ratio: number): FibLevelState[] {
  return levels.filter((l) => l.ratio !== ratio);
}

/**
 * Add a level from a percentage (e.g. 127.2 → ratio 1.272).
 * Returns `null` for invalid or duplicate input.
 */
export function addLevel(levels: FibLevelState[], ratioPct: number): FibLevelState[] | null {
  const ratio = ratioPct / 100;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 10) return null;
  const rounded = Math.round(ratio * 10_000) / 10_000;
  if (levels.some((l) => Math.abs(l.ratio - rounded) < 1e-9)) return null;
  return [...levels, { ratio: rounded, enabled: true }].sort((x, y) => x.ratio - y.ratio);
}

/** Shortest distance (in px) from a point to a line segment. */
export function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
