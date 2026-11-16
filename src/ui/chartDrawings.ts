/**
 * Canvas overlay for chart drawings and price-pane indicators (moving
 * average, Bollinger Bands). Oscillator indicators render as native series in
 * their own panes below the price chart.
 *
 * `drawOverlay` runs inside the chart's requestAnimationFrame loop and converts
 * stored chart coordinates (UTC time + price) to pixels on every frame, so the
 * drawings stay glued to the chart while it pans, zooms and replays.
 */
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { Bar } from "../engine/types";
import { getSymbolSpec } from "../engine/symbols";
import { hexToRgba } from "../lib/color";
import {
  ensureIndicatorValues,
  createIndicatorValuesCache,
  type IndicatorValuesCache,
} from "../lib/indicators";
import {
  indicatorDef,
  indicatorOutputs,
  indicatorSignature,
  type IndicatorInstance,
} from "../lib/indicatorRegistry";
import {
  distToSegment,
  FIB_COLOR_BY_KIND,
  fibPrice,
  ratioLabel,
  type FibAnchor,
  type FibDrawing,
  type FibToolKind,
} from "../lib/fib";
import { fmtPips, fmtSpan, measureStats, type MeasurePoint } from "../lib/measure";
import {
  rayExit,
  SHAPE_COLOR_BY_KIND,
  type DrawingShape,
  type ShapePoint,
  type ShapeToolKind,
} from "../lib/shapes";

export interface OverlayData {
  symbol: string;
  bars: Bar[];
}

export interface HoverPoint {
  x: number;
  y: number;
}

/** MT4-style crosshair measurement between two clicked chart points. */
export interface MeasureState {
  a: MeasurePoint;
  /** Finalised second point; the ruler is only complete when set. */
  b: MeasurePoint | null;
  /** Live point under the pointer while picking the second point. */
  preview: MeasurePoint | null;
}

export interface OverlayState {
  fibs: FibDrawing[];
  fibAnchor: FibAnchor | null;
  fibTool: FibToolKind | null;
  shapes: DrawingShape[];
  shapeTool: ShapeToolKind | null;
  shapeAnchor: ShapePoint | null;
  indicators: IndicatorInstance[];
  hover: HoverPoint | null;
  measure: MeasureState | null;
}

export interface FibGeometry {
  xA: number;
  xB: number;
  yA: number;
  yB: number;
}

export interface FibHit {
  fib: FibDrawing;
  /** Set when the pointer is over a horizontal level segment. */
  levelRatio?: number;
}

export interface ShapeHit {
  shape: DrawingShape;
  /** Set when the pointer is over a trend-line endpoint. */
  anchor: "a" | "b" | null;
}

const MONO_FONT = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function fibGeometry(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  fib: FibDrawing,
): FibGeometry | null {
  const xA = chart.timeScale().timeToCoordinate(fib.a.time as UTCTimestamp);
  const xB = chart.timeScale().timeToCoordinate(fib.b.time as UTCTimestamp);
  const yA = series.priceToCoordinate(fib.a.price);
  const yB = series.priceToCoordinate(fib.b.price);
  if (xA == null || xB == null || yA == null || yB == null) return null;
  return { xA, xB, yA, yB };
}

export function hitTestFib(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  fibs: FibDrawing[],
  x: number,
  y: number,
): FibHit | null {
  const halfBar = Math.max(6, chart.timeScale().options().barSpacing / 2);
  const diagTolerance = Math.max(9, halfBar);
  const anchorTolerance = Math.max(10, halfBar + 2);
  for (let i = fibs.length - 1; i >= 0; i--) {
    const fib = fibs[i];
    const g = fibGeometry(chart, series, fib);
    if (!g) continue;
    const left = Math.min(g.xA, g.xB);
    const right = Math.max(g.xA, g.xB);
    if (x >= left - 3 && x <= right + 3) {
      for (const lvl of fib.levels) {
        if (!lvl.enabled) continue;
        const ly = series.priceToCoordinate(fibPrice(fib.a.price, fib.b.price, lvl.ratio));
        if (ly != null && Math.abs(y - ly) <= 5) return { fib, levelRatio: lvl.ratio };
      }
    }
    if (distToSegment(x, y, g.xA, g.yA, g.xB, g.yB) <= diagTolerance) return { fib };
    if (Math.hypot(x - g.xA, y - g.yA) <= anchorTolerance || Math.hypot(x - g.xB, y - g.yB) <= anchorTolerance) {
      return { fib };
    }
  }
  return null;
}

export function hitTestFibAnchor(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  fibs: FibDrawing[],
  x: number,
  y: number,
): { fib: FibDrawing; side: "a" | "b" } | null {
  const halfBar = Math.max(6, chart.timeScale().options().barSpacing / 2);
  const tol = Math.max(10, halfBar + 2);
  for (let i = fibs.length - 1; i >= 0; i--) {
    const fib = fibs[i];
    const g = fibGeometry(chart, series, fib);
    if (!g) continue;
    if (Math.hypot(x - g.xA, y - g.yA) <= tol) return { fib, side: "a" };
    if (Math.hypot(x - g.xB, y - g.yB) <= tol) return { fib, side: "b" };
  }
  return null;
}

export function hitTestShape(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  shapes: DrawingShape[],
  x: number,
  y: number,
): ShapeHit | null {
  const pane = chart.paneSize();
  if (x < 0 || y < 0 || x > pane.width || y > pane.height) return null;
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (shape.kind === "vertical") {
      const sx = chart.timeScale().timeToCoordinate(shape.a.time as UTCTimestamp);
      if (sx != null && Math.abs(x - sx) <= 5) return { shape, anchor: null };
    } else if (shape.kind === "horizontal") {
      const sy = series.priceToCoordinate(shape.a.price);
      if (sy != null && Math.abs(y - sy) <= 5) return { shape, anchor: null };
    } else if (shape.b) {
      const ax = chart.timeScale().timeToCoordinate(shape.a.time as UTCTimestamp);
      const ay = series.priceToCoordinate(shape.a.price);
      const bx = chart.timeScale().timeToCoordinate(shape.b.time as UTCTimestamp);
      const by = series.priceToCoordinate(shape.b.price);
      if (ax == null || ay == null || bx == null || by == null) continue;
      if (Math.hypot(x - ax, y - ay) <= 10) return { shape, anchor: "a" };
      if (Math.hypot(x - bx, y - by) <= 10) return { shape, anchor: "b" };
      if (distToSegment(x, y, ax, ay, bx, by) <= 6) return { shape, anchor: null };
      // The projected part of a trend line is grabbable too.
      const exit = rayExit({ x: ax, y: ay }, { x: bx, y: by }, pane.width, pane.height);
      if (exit && distToSegment(x, y, bx, by, exit.x, exit.y) <= 6) return { shape, anchor: null };
    }
  }
  return null;
}

/** Returns the indicator id whose line (or bound) is under the pointer. */
export function hitTestIndicator(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  data: OverlayData,
  pos: number,
  indicators: IndicatorInstance[],
  caches: Map<number, IndicatorValuesCache>,
  x: number,
  y: number,
): number | null {
  const pane = chart.paneSize();
  if (x < 0 || y < 0 || x > pane.width || y > pane.height) return null;
  const logical = chart.timeScale().coordinateToLogical(x);
  if (logical == null) return null;
  const processed = Math.max(0, Math.min(pos, data.bars.length));
  const index = Math.round(logical);
  if (index < 0 || index >= processed) return null;

  for (let i = indicators.length - 1; i >= 0; i--) {
    const inst = indicators[i];
    const def = indicatorDef(inst.kind);
    if (def.placement !== "price") continue;
    const values = indicatorValuesFor(inst, data, processed, caches);
    for (const output of indicatorOutputs(inst)) {
      const value = values[output.key]?.[index];
      if (value == null) continue;
      const vy = series.priceToCoordinate(value);
      if (vy != null && Math.abs(y - vy) <= 6) return inst.id;
    }
  }
  return null;
}

/** Indicator values for the first `count` bars, shared with the chart caches. */
function indicatorValuesFor(
  inst: IndicatorInstance,
  data: OverlayData,
  count: number,
  caches: Map<number, IndicatorValuesCache>,
): Record<string, (number | null)[]> {
  const spec = getSymbolSpec(data.symbol);
  const def = indicatorDef(inst.kind);
  let cache = caches.get(inst.id);
  if (!cache) {
    cache = createIndicatorValuesCache();
    caches.set(inst.id, cache);
  }
  return ensureIndicatorValues(cache, data.bars, indicatorSignature(inst, spec.pipSize), count, () =>
    def.compute(data.bars, count, inst.params, { pipSize: spec.pipSize }),
  );
}

interface ScreenPoint {
  index: number;
  x: number;
  y: number;
  value: number;
}

function outputPoints(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  data: OverlayData,
  pos: number,
  outputKey: string,
  values: Record<string, (number | null)[]>,
): ScreenPoint[] {
  const processed = Math.max(0, Math.min(pos, data.bars.length));
  if (processed === 0) return [];
  const vals = values[outputKey];
  if (!vals) return [];

  let from = 0;
  let to = processed - 1;
  const visible = chart.timeScale().getVisibleLogicalRange();
  if (visible) {
    from = Math.max(0, Math.floor(visible.from) - 1);
    to = Math.min(processed - 1, Math.ceil(visible.to) + 1);
  }
  if (to < from) return [];

  const points: ScreenPoint[] = [];
  for (let i = from; i <= to; i++) {
    const value = vals[i];
    if (value == null) continue;
    const x = chart.timeScale().timeToCoordinate(data.bars[i].ts as UTCTimestamp);
    const y = series.priceToCoordinate(value);
    if (x == null || y == null) continue;
    points.push({ index: i, x, y, value });
  }
  return points;
}

/** Price-pane indicators (MA, Bollinger): lines, optional direction colours. */
function drawIndicator(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  data: OverlayData,
  pos: number,
  inst: IndicatorInstance,
  caches: Map<number, IndicatorValuesCache>,
): void {
  const def = indicatorDef(inst.kind);
  if (def.placement !== "price") return;
  const processed = Math.max(0, Math.min(pos, data.bars.length));
  if (processed === 0) return;
  const spec = getSymbolSpec(data.symbol);
  const values = indicatorValuesFor(inst, data, processed, caches);
  const outputs = indicatorOutputs(inst);

  ctx.save();
  for (const out of outputs) {
    const points = outputPoints(chart, series, data, pos, out.key, values);
    if (points.length === 0) continue;
    ctx.setLineDash(out.dashed ? [3, 3] : []);
    if (out.upColor && out.downColor) {
      ctx.lineWidth = 1.6;
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const cur = points[i];
        if (cur.index !== prev.index + 1) continue;
        ctx.strokeStyle = cur.value >= prev.value ? out.upColor : out.downColor;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(cur.x, cur.y);
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = out.dashed ? 1 : 1.6;
      ctx.strokeStyle = out.color;
      ctx.beginPath();
      points.forEach((p, i) => {
        if (i === 0 || p.index !== points[i - 1].index + 1) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }
  }

  // The end-of-line label belongs to the main (first) output.
  const main = outputs[0];
  const mainPoints = main ? outputPoints(chart, series, data, pos, main.key, values) : [];
  if (main && mainPoints.length > 0) {
    const last = mainPoints[mainPoints.length - 1];
    const prev = mainPoints.length > 1 ? mainPoints[mainPoints.length - 2] : null;
    const mainUp = prev == null || last.value >= prev.value;
    ctx.fillStyle = main.upColor && main.downColor ? (mainUp ? main.upColor : main.downColor) : main.color;
    ctx.font = MONO_FONT;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${def.title(inst.params)} ${last.value.toFixed(main.digits ?? spec.digits)}`, last.x - 6, last.y - 3);
  }
  ctx.restore();
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  shape: DrawingShape,
  digits: number,
): void {
  const pane = chart.paneSize();
  ctx.save();
  ctx.strokeStyle = hexToRgba(shape.color, 0.95);
  ctx.fillStyle = shape.color;
  ctx.lineWidth = 1.5;

  if (shape.kind === "vertical") {
    const x = chart.timeScale().timeToCoordinate(shape.a.time as UTCTimestamp);
    if (x != null) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, pane.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x - 4, 6);
      ctx.lineTo(x + 4, 6);
      ctx.closePath();
      ctx.fill();
    }
  } else if (shape.kind === "horizontal") {
    const y = series.priceToCoordinate(shape.a.price);
    if (y != null) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(pane.width, y);
      ctx.stroke();
      ctx.font = MONO_FONT;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(shape.a.price.toFixed(digits), pane.width - 4, y - 2);
    }
  } else if (shape.b) {
    const ax = chart.timeScale().timeToCoordinate(shape.a.time as UTCTimestamp);
    const ay = series.priceToCoordinate(shape.a.price);
    const bx = chart.timeScale().timeToCoordinate(shape.b.time as UTCTimestamp);
    const by = series.priceToCoordinate(shape.b.price);
    if (ax != null && ay != null && bx != null && by != null) {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();

      // Trend lines keep going past the second point until they leave the
      // price pane, so the slope stays readable across the whole chart window.
      const exit = rayExit({ x: ax, y: ay }, { x: bx, y: by }, pane.width, pane.height);
      if (exit) {
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = hexToRgba(shape.color, 0.55);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(exit.x, exit.y);
        ctx.stroke();
        ctx.restore();
      }

      for (const [hx, hy] of [
        [ax, ay],
        [bx, by],
      ] as const) {
        ctx.beginPath();
        ctx.arc(hx, hy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawFib(
  ctx: CanvasRenderingContext2D,
  series: ISeriesApi<"Candlestick">,
  fib: FibDrawing,
  g: FibGeometry,
  digits: number,
): void {
  const { xA, xB, yA, yB } = g;
  const left = Math.min(xA, xB);
  const right = Math.max(xA, xB);
  ctx.save();

  // Diagonal connecting the two swing points.
  ctx.strokeStyle = hexToRgba(fib.color, 0.85);
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(xA, yA);
  ctx.lineTo(xB, yB);
  ctx.stroke();

  // Horizontal levels, spanning only between the two clicked points.
  ctx.setLineDash([4, 4]);
  for (const lvl of fib.levels) {
    if (!lvl.enabled) continue;
    const price = fibPrice(fib.a.price, fib.b.price, lvl.ratio);
    const y = series.priceToCoordinate(price);
    if (y == null) continue;
    const golden = Math.abs(lvl.ratio - 0.618) < 1e-9;
    ctx.strokeStyle = hexToRgba(fib.color, golden ? 0.95 : 0.8);
    ctx.lineWidth = golden ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = fib.color;
    ctx.font = MONO_FONT;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${ratioLabel(lvl.ratio)} ${price.toFixed(digits)}`, right - 3, y - 2);
    ctx.setLineDash([4, 4]);
  }

  // Anchor handles.
  ctx.setLineDash([]);
  ctx.fillStyle = fib.color;
  for (const [x, y] of [
    [xA, yA],
    [xB, yB],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFibAnchorPreview(
  ctx: CanvasRenderingContext2D,
  series: ISeriesApi<"Candlestick">,
  anchor: FibAnchor,
  tool: FibToolKind | null,
  digits: number,
  plotWidth: number,
): void {
  const y = series.priceToCoordinate(anchor.price);
  if (y == null) return;
  const color = tool ? FIB_COLOR_BY_KIND[tool] : "#2dd4bf";
  ctx.save();
  ctx.strokeStyle = hexToRgba(color, 0.9);
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(plotWidth, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = MONO_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(`0% ${anchor.price.toFixed(digits)} — click swing point 2`, 8, y - 2);
  ctx.restore();
}

function drawShapePreview(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  tool: ShapeToolKind | null,
  anchor: ShapePoint | null,
  hover: HoverPoint | null,
  plotWidth: number,
  plotHeight: number,
): void {
  if (!tool) return;
  const color = hexToRgba(SHAPE_COLOR_BY_KIND[tool], 0.85);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = SHAPE_COLOR_BY_KIND[tool];
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  if (tool === "vertical") {
    if (hover && hover.x >= 0 && hover.x <= plotWidth) {
      ctx.beginPath();
      ctx.moveTo(hover.x, 0);
      ctx.lineTo(hover.x, plotHeight);
      ctx.stroke();
    }
  } else if (tool === "horizontal") {
    if (hover && hover.y >= 0 && hover.y <= plotHeight) {
      ctx.beginPath();
      ctx.moveTo(0, hover.y);
      ctx.lineTo(plotWidth, hover.y);
      ctx.stroke();
    }
  } else if (hover && anchor) {
    const ax = chart.timeScale().timeToCoordinate(anchor.time as UTCTimestamp);
    const ay = series.priceToCoordinate(anchor.price);
    if (ax != null && ay != null) {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(hover.x, hover.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(ax, ay, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

const MEASURE_COLOR = "#fbbf24";

interface MeasureRow {
  text: string;
  color: string;
}

/** Dashed vertical + horizontal guides through one measured point. */
function drawMeasureGuides(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  plotWidth: number,
  plotHeight: number,
): void {
  ctx.strokeStyle = hexToRgba(MEASURE_COLOR, 0.32);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, plotHeight);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(plotWidth, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Small price chip next to a measured point (left/below when near an edge). */
function drawMeasureTag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  plotWidth: number,
): void {
  const padX = 4;
  const h = 13;
  ctx.font = MONO_FONT;
  const w = ctx.measureText(text).width + padX * 2;
  const bx = x + 8 + w <= plotWidth - 2 ? x + 8 : Math.max(2, x - 8 - w);
  const by = y - h - 4 < 2 ? y + 4 : y - h - 4;
  ctx.save();
  ctx.fillStyle = "rgba(10,16,22,0.85)";
  ctx.fillRect(bx, by, w, h);
  ctx.fillStyle = MEASURE_COLOR;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + padX, by + h / 2);
  ctx.restore();
}

/** Info box with the bar count / time span / pip-point distance. */
function drawMeasureBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rows: MeasureRow[],
  plotWidth: number,
  plotHeight: number,
): void {
  const padX = 7;
  const padY = 6;
  const lineH = 13;
  ctx.font = MONO_FONT;
  const textW = Math.max(...rows.map((row) => ctx.measureText(row.text).width));
  const boxW = textW + padX * 2;
  const boxH = rows.length * lineH + padY * 2;
  let bx = x + 14;
  let by = y - boxH - 10;
  if (bx + boxW > plotWidth - 4) bx = x - 14 - boxW;
  bx = Math.max(4, Math.min(plotWidth - boxW - 4, bx));
  if (by < 4) by = y + 10;
  by = Math.max(4, Math.min(plotHeight - boxH - 4, by));

  ctx.save();
  ctx.fillStyle = "rgba(10,16,22,0.92)";
  ctx.strokeStyle = hexToRgba(MEASURE_COLOR, 0.75);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(bx, by, boxW, boxH);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  rows.forEach((row, i) => {
    ctx.fillStyle = row.color;
    ctx.fillText(row.text, bx + padX, by + padY + i * lineH + lineH / 2);
  });
  ctx.restore();
}

function drawMeasure(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  data: OverlayData,
  measure: MeasureState,
  plotWidth: number,
  plotHeight: number,
): void {
  const spec = getSymbolSpec(data.symbol);
  const a = measure.a;
  const b = measure.b ?? measure.preview;
  const xA = chart.timeScale().timeToCoordinate(a.time as UTCTimestamp);
  const yA = series.priceToCoordinate(a.price);
  if (xA == null || yA == null) return;

  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = MONO_FONT;
  ctx.textBaseline = "bottom";

  drawMeasureGuides(ctx, xA, yA, plotWidth, plotHeight);
  ctx.fillStyle = MEASURE_COLOR;
  ctx.beginPath();
  ctx.arc(xA, yA, 3, 0, Math.PI * 2);
  ctx.fill();
  drawMeasureTag(ctx, xA, yA, `A ${a.price.toFixed(spec.digits)}`, plotWidth);

  if (!b) {
    drawMeasureBox(
      ctx,
      xA,
      yA,
      [{ text: "crosshair: click the 2nd point", color: "#fde68a" }],
      plotWidth,
      plotHeight,
    );
    ctx.restore();
    return;
  }

  const xB = chart.timeScale().timeToCoordinate(b.time as UTCTimestamp);
  const yB = series.priceToCoordinate(b.price);
  if (xB == null || yB == null) {
    ctx.restore();
    return;
  }

  drawMeasureGuides(ctx, xB, yB, plotWidth, plotHeight);

  // Box outlining the measured span, then the diagonal between the points.
  ctx.strokeStyle = hexToRgba(MEASURE_COLOR, 0.45);
  ctx.setLineDash([2, 3]);
  ctx.strokeRect(Math.min(xA, xB), Math.min(yA, yB), Math.abs(xB - xA), Math.abs(yB - yA));

  ctx.strokeStyle = hexToRgba(MEASURE_COLOR, 0.95);
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(xA, yA);
  ctx.lineTo(xB, yB);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = MEASURE_COLOR;
  for (const [x, y] of [
    [xA, yA],
    [xB, yB],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  drawMeasureTag(ctx, xB, yB, `B ${b.price.toFixed(spec.digits)}`, plotWidth);

  const stats = measureStats(a, b, spec);
  const arrow = stats.direction === "up" ? "▲" : stats.direction === "down" ? "▼" : "→";
  drawMeasureBox(
    ctx,
    xB,
    yB,
    [
      { text: `${stats.bars} bar${stats.bars === 1 ? "" : "s"} · ${fmtSpan(stats.seconds)}`, color: "#fde68a" },
      { text: `${arrow} ${fmtPips(stats.pips)} pips (${stats.points.toLocaleString("en-US")} pts)`, color: "#e5e7eb" },
    ],
    plotWidth,
    plotHeight,
  );
  ctx.restore();
}

export function drawOverlay(
  canvas: HTMLCanvasElement,
  chart: IChartApi | null,
  series: ISeriesApi<"Candlestick"> | null,
  data: OverlayData | null,
  pos: number,
  state: OverlayState,
  caches: Map<number, IndicatorValuesCache>,
): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.max(1, Math.round(w * dpr));
  const ch = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== cw) canvas.width = cw;
  if (canvas.height !== ch) canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!chart || !series || !data) return;

  const pane = chart.paneSize();
  const plotWidth = Math.max(0, Math.min(w, pane.width));
  const plotHeight = Math.max(0, Math.min(h, pane.height));
  if (plotWidth === 0 || plotHeight === 0) return;
  const digits = getSymbolSpec(data.symbol).digits;

  // Clip every tool to the price pane so lines never run over the axes.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, plotWidth, plotHeight);
  ctx.clip();

  for (const inst of state.indicators) {
    drawIndicator(ctx, chart, series, data, pos, inst, caches);
  }
  for (const shape of state.shapes) {
    drawShape(ctx, chart, series, shape, digits);
  }
  for (const fib of state.fibs) {
    const g = fibGeometry(chart, series, fib);
    if (g) drawFib(ctx, series, fib, g, digits);
  }

  if (state.fibTool && state.fibAnchor) {
    drawFibAnchorPreview(ctx, series, state.fibAnchor, state.fibTool, digits, plotWidth);
  }
  drawShapePreview(ctx, chart, series, state.shapeTool, state.shapeAnchor, state.hover, plotWidth, plotHeight);

  if (state.measure) {
    drawMeasure(ctx, chart, series, data, state.measure, plotWidth, plotHeight);
  }

  ctx.restore();
}
