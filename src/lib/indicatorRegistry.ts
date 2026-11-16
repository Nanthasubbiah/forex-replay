/**
 * Generic indicator model and registry.
 *
 * An indicator is a pure `compute(bars, count, params) → buffers` function
 * plus rendering metadata: where it draws (price pane or its own pane below),
 * which parameters it takes and which outputs are lines / histograms.
 *
 * The chart renders "price" indicators on its canvas overlay and "pane"
 * oscillators as native lightweight-charts series, so all of them share one
 * registry, one editor and one on-chart list.
 */
import type { Bar } from "../engine/types";
import {
  closesOf,
  computeAtr,
  computeBollinger,
  computeMacd,
  computeMovingAverage,
  computeRsi,
  maLabel,
} from "./indicators";

export type IndicatorKind = "ma" | "rsi" | "macd" | "atr" | "bollinger";
export type IndicatorPlacement = "price" | "pane";
export type IndicatorLineStyle = "line" | "histogram";

export interface IndicatorParamSpec {
  key: string;
  label: string;
  default: number;
  min?: number;
  max?: number;
  /** Step for the number input; integer params round to whole bars. */
  step?: number;
  integer?: boolean;
  /** Render as a checkbox (0 / 1) instead of a number input. */
  boolean?: boolean;
  /** Render as a select; only the listed values are allowed. */
  options?: { value: number; label: string }[];
  /** Hide the field when the predicate is false for the current params. */
  visible?: (params: Record<string, number>) => boolean;
}

export interface IndicatorColorSpec {
  key: string;
  label: string;
  default: string;
  visible?: (params: Record<string, number>) => boolean;
}

export interface IndicatorOutput {
  key: string;
  style: IndicatorLineStyle;
  color: string;
  /** Histogram / direction-coloured line: colour by sign or by direction. */
  upColor?: string;
  downColor?: string;
  dashed?: boolean;
  /** Decimals for end-of-line labels; defaults to the symbol digits. */
  digits?: number;
}

export interface IndicatorLevel {
  value: number;
  color?: string;
  label?: string;
}

export interface IndicatorComputeContext {
  /** Contract pip size, used by pip-relative outputs (MA bounds). */
  pipSize: number;
}

export interface IndicatorDef {
  kind: IndicatorKind;
  label: string;
  description: string;
  placement: IndicatorPlacement;
  params: IndicatorParamSpec[];
  colors: IndicatorColorSpec[];
  outputs(params: Record<string, number>, colors: Record<string, string>): IndicatorOutput[];
  compute(
    bars: Bar[],
    count: number,
    params: Record<string, number>,
    ctx: IndicatorComputeContext,
  ): Record<string, (number | null)[]>;
  levels?(params: Record<string, number>): IndicatorLevel[];
  /** Short list label, e.g. "RSI 14". */
  title(params: Record<string, number>): string;
}

/** One configured indicator on the chart (state lives in the store). */
export interface IndicatorInstance {
  id: number;
  kind: IndicatorKind;
  params: Record<string, number>;
  colors: Record<string, string>;
}

export const INDICATOR_COLOR_PRESETS = [
  "#f59e0b",
  "#22d3ee",
  "#a78bfa",
  "#34d399",
  "#f87171",
  "#e5e7eb",
  "#38bdf8",
  "#f472b6",
  "#94a3b8",
];

const MA_METHODS = [
  { value: 0, label: "Simple (SMA)" },
  { value: 1, label: "Exponential (EMA)" },
];

const movingAverage: IndicatorDef = {
  kind: "ma",
  label: "Moving average",
  description: "SMA/EMA over the close, with optional direction colours and pip bounds.",
  placement: "price",
  params: [
    { key: "period", label: "Period (bars)", default: 20, min: 1, max: 5000, step: 1, integer: true },
    { key: "method", label: "Method", default: 0, options: MA_METHODS },
    { key: "colored", label: "Colour by direction — two colours for rising and falling", default: 0, boolean: true },
    { key: "showBounds", label: "Add a bound above and below the MA (shifted by pips)", default: 0, boolean: true },
    {
      key: "boundPips",
      label: "Bound distance (pips)",
      default: 10,
      min: 0,
      step: 0.1,
      visible: (p) => (p.showBounds ?? 0) > 0.5,
    },
  ],
  colors: [
    { key: "line", label: "Line", default: "#f59e0b" },
    { key: "up", label: "Rising", default: "#22c55e", visible: (p) => (p.colored ?? 0) > 0.5 },
    { key: "down", label: "Falling", default: "#ef4444", visible: (p) => (p.colored ?? 0) > 0.5 },
    { key: "bound", label: "Bounds", default: "#94a3b8", visible: (p) => (p.showBounds ?? 0) > 0.5 },
  ],
  outputs(params, colors) {
    const out: IndicatorOutput[] = [
      {
        key: "ma",
        style: "line",
        color: colors.line,
        ...(params.colored > 0.5 ? { upColor: colors.up, downColor: colors.down } : {}),
      },
    ];
    if (params.showBounds > 0.5) {
      out.push({ key: "upper", style: "line", color: colors.bound, dashed: true });
      out.push({ key: "lower", style: "line", color: colors.bound, dashed: true });
    }
    return out;
  },
  compute(bars, count, params, ctx) {
    const period = Math.max(1, Math.floor(params.period));
    const values = computeMovingAverage(closesOf(bars, count), period, params.method > 0.5 ? "ema" : "sma");
    const result: Record<string, (number | null)[]> = { ma: values };
    if (params.showBounds > 0.5) {
      const shift = params.boundPips * ctx.pipSize;
      result.upper = values.map((v) => (v == null ? null : v + shift));
      result.lower = values.map((v) => (v == null ? null : v - shift));
    }
    return result;
  },
  title: (params) => maLabel({ period: Math.max(1, Math.floor(params.period)), type: params.method > 0.5 ? "ema" : "sma" }),
};

const rsi: IndicatorDef = {
  kind: "rsi",
  label: "RSI",
  description: "Relative Strength Index (Wilder) in its own pane with 30 / 70 guides.",
  placement: "pane",
  params: [{ key: "period", label: "Period (bars)", default: 14, min: 2, max: 500, step: 1, integer: true }],
  colors: [{ key: "line", label: "Line", default: "#a78bfa" }],
  levels: () => [
    { value: 30, color: "#64748b" },
    { value: 70, color: "#64748b" },
    { value: 50, color: "#334155" },
  ],
  outputs: (_params, colors) => [{ key: "rsi", style: "line", color: colors.line, digits: 2 }],
  compute(bars, count, params) {
    return { rsi: computeRsi(bars, count, Math.max(2, Math.floor(params.period))) };
  },
  title: (params) => `RSI ${Math.max(2, Math.floor(params.period))}`,
};

const macd: IndicatorDef = {
  kind: "macd",
  label: "MACD",
  description: "MACD line, signal line and coloured histogram in their own pane.",
  placement: "pane",
  params: [
    { key: "fast", label: "Fast EMA", default: 12, min: 1, max: 500, step: 1, integer: true },
    { key: "slow", label: "Slow EMA", default: 26, min: 1, max: 500, step: 1, integer: true },
    { key: "signal", label: "Signal EMA", default: 9, min: 1, max: 500, step: 1, integer: true },
  ],
  colors: [
    { key: "macd", label: "MACD line", default: "#38bdf8" },
    { key: "signal", label: "Signal line", default: "#f472b6" },
    { key: "up", label: "Histogram up", default: "#22c55e" },
    { key: "down", label: "Histogram down", default: "#ef4444" },
  ],
  outputs: (_params, colors) => [
    { key: "hist", style: "histogram", color: colors.up, upColor: colors.up, downColor: colors.down },
    { key: "macd", style: "line", color: colors.macd },
    { key: "signal", style: "line", color: colors.signal },
  ],
  compute(bars, count, params) {
    const fast = Math.max(1, Math.floor(params.fast));
    const slow = Math.max(1, Math.floor(params.slow));
    const signal = Math.max(1, Math.floor(params.signal));
    return computeMacd(bars, count, fast, slow, signal) as unknown as Record<string, (number | null)[]>;
  },
  title: (params) =>
    `MACD ${Math.max(1, Math.floor(params.fast))},${Math.max(1, Math.floor(params.slow))},${Math.max(1, Math.floor(params.signal))}`,
};

const atr: IndicatorDef = {
  kind: "atr",
  label: "ATR",
  description: "Average True Range (Wilder) in its own pane.",
  placement: "pane",
  params: [{ key: "period", label: "Period (bars)", default: 14, min: 1, max: 500, step: 1, integer: true }],
  colors: [{ key: "line", label: "Line", default: "#f59e0b" }],
  outputs: (_params, colors) => [{ key: "atr", style: "line", color: colors.line }],
  compute(bars, count, params) {
    return { atr: computeAtr(bars, count, Math.max(1, Math.floor(params.period))) };
  },
  title: (params) => `ATR ${Math.max(1, Math.floor(params.period))}`,
};

const bollinger: IndicatorDef = {
  kind: "bollinger",
  label: "Bollinger Bands",
  description: "SMA basis with upper / lower bands, drawn on the price pane.",
  placement: "price",
  params: [
    { key: "period", label: "Period (bars)", default: 20, min: 2, max: 5000, step: 1, integer: true },
    { key: "deviation", label: "Standard deviations", default: 2, min: 0.1, max: 10, step: 0.1 },
  ],
  colors: [
    { key: "basis", label: "Basis line", default: "#f59e0b" },
    { key: "band", label: "Bands", default: "#94a3b8" },
  ],
  outputs: (_params, colors) => [
    { key: "basis", style: "line", color: colors.basis },
    { key: "upper", style: "line", color: colors.band, dashed: true },
    { key: "lower", style: "line", color: colors.band, dashed: true },
  ],
  compute(bars, count, params) {
    return computeBollinger(
      bars,
      count,
      Math.max(2, Math.floor(params.period)),
      Math.max(0, params.deviation),
    ) as unknown as Record<string, (number | null)[]>;
  },
  title: (params) =>
    `BB ${Math.max(2, Math.floor(params.period))}, ${(Math.round(params.deviation * 10) / 10).toString()}`,
};

export const INDICATOR_KINDS: IndicatorKind[] = ["ma", "rsi", "macd", "atr", "bollinger"];

export const INDICATOR_DEFS: Record<IndicatorKind, IndicatorDef> = {
  ma: movingAverage,
  rsi,
  macd,
  atr,
  bollinger,
};

export function indicatorDef(kind: IndicatorKind): IndicatorDef {
  return INDICATOR_DEFS[kind];
}

/** New instance with the registry defaults filled in. */
export function createIndicatorInstance(kind: IndicatorKind, id: number): IndicatorInstance {
  const def = indicatorDef(kind);
  const params: Record<string, number> = {};
  for (const spec of def.params) params[spec.key] = spec.default;
  const colors: Record<string, string> = {};
  for (const spec of def.colors) colors[spec.key] = spec.default;
  return { id, kind, params, colors };
}

export function indicatorOutputs(inst: IndicatorInstance): IndicatorOutput[] {
  return indicatorDef(inst.kind).outputs(inst.params, inst.colors);
}

export function indicatorTitle(inst: IndicatorInstance): string {
  return indicatorDef(inst.kind).title(inst.params);
}

/** Stable cache signature: kind + numeric params + pip size. */
export function indicatorSignature(inst: IndicatorInstance, pipSize: number): string {
  return `${inst.kind}|${JSON.stringify(inst.params)}|${pipSize}`;
}
