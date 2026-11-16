/**
 * MT4-style crosshair ruler math.
 *
 * Two clicked chart points define a span. Everything the ruler shows — bar
 * count, elapsed time and the price distance expressed in pips and points —
 * is a pure function of those two points plus the symbol contract spec, so the
 * same numbers work for FX, metals, indices and crypto.
 */
import type { SymbolSpec } from "../engine/types";

export interface MeasurePoint {
  /** Bar index the click snapped to. */
  index: number;
  /** Bar timestamp (seconds, UTC). */
  time: number;
  price: number;
}

export interface MeasureStats {
  /** Absolute number of bars between the two points. */
  bars: number;
  /** Signed time difference in seconds (second point minus first). */
  seconds: number;
  /** Signed price difference: second point minus first. */
  priceDelta: number;
  /** Absolute distance in pips (1 pip = `spec.pipSize`). */
  pips: number;
  /** Absolute distance in points (1 point = one price digit step). */
  points: number;
  direction: "up" | "down" | "flat";
}

export function measureStats(a: MeasurePoint, b: MeasurePoint, spec: SymbolSpec): MeasureStats {
  const priceDelta = b.price - a.price;
  const abs = Math.abs(priceDelta);
  const pipSize = spec.pipSize > 0 ? spec.pipSize : Math.pow(10, -spec.digits);
  const pointSize = Math.pow(10, -spec.digits);
  return {
    bars: Math.abs(b.index - a.index),
    seconds: b.time - a.time,
    priceDelta,
    pips: abs / pipSize,
    points: Math.round(abs / pointSize),
    direction: priceDelta > 0 ? "up" : priceDelta < 0 ? "down" : "flat",
  };
}

/** "45s", "12m", "3h 30m", "2d 4h" — the time-span row of the ruler label. */
export function fmtSpan(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rm = m % 60;
    return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
  }
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh === 0 ? `${d}d` : `${d}d ${rh}h`;
}

/** Pips can be fractional on metals/indices — trim to at most one decimal. */
export function fmtPips(pips: number): string {
  const rounded = Math.round(pips * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
