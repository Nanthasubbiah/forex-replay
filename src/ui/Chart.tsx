import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useStore } from "../store";
import type { LoadedData } from "../store";
import type { Simulator } from "../engine/simulator";
import type { Bar, PendingType } from "../engine/types";
import { getSymbolSpec } from "../engine/symbols";
import {
  FIB_COLOR_BY_KIND,
  fibLevelsFor,
  ratioLabel,
  toggleLevel,
  type FibAnchor,
  type FibDrawing,
  type FibToolKind,
} from "../lib/fib";
import { createIndicatorValuesCache, ensureIndicatorValues, type IndicatorValuesCache } from "../lib/indicators";
import {
  indicatorDef,
  indicatorOutputs,
  indicatorSignature,
  type IndicatorInstance,
  type IndicatorOutput,
} from "../lib/indicatorRegistry";
import type { MeasurePoint } from "../lib/measure";
import { SHAPE_COLOR_BY_KIND, type DrawingShape, type ShapePoint, type ShapeToolKind } from "../lib/shapes";
import {
  drawOverlay,
  hitTestFib,
  hitTestFibAnchor,
  hitTestIndicator,
  hitTestShape,
  type HoverPoint,
} from "./chartDrawings";
import { FibEditor } from "./FibEditor";
import { IndicatorEditor } from "./IndicatorEditor";
import { ShapeEditor } from "./ShapeEditor";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { fmtPrice, fmtSigned, fmtTime } from "../lib/format";

type MarkersApi = ISeriesMarkersPluginApi<Time>;

const PENDING_LABELS: Record<PendingType, string> = {
  buy_limit: "BUY LIMIT",
  sell_limit: "SELL LIMIT",
  buy_stop: "BUY STOP",
  sell_stop: "SELL STOP",
};

interface FibDragState {
  kind: "fib";
  mode: "move" | "anchorA" | "anchorB";
  fib: FibDrawing;
  idxA: number;
  idxB: number;
  startX: number;
  startY: number;
  moved: boolean;
}

interface ShapeDragState {
  kind: "shape";
  mode: "move" | "anchorA" | "anchorB";
  shape: DrawingShape;
  idxA: number;
  idxB: number;
  startX: number;
  startY: number;
  moved: boolean;
}

/** Dragging an SL/TP price line of a live position or a pending order. */
interface StopsDragState {
  kind: "stops";
  scope: "position" | "pending";
  ticket: number;
  field: "sl" | "tp";
  /** Latest (already clamped) price under the pointer. */
  price: number;
  startX: number;
  startY: number;
  moved: boolean;
}

type DragState = FibDragState | ShapeDragState | StopsDragState;

/** One oscillator indicator rendered as native series in its own pane. */
interface PaneSeriesRuntime {
  id: number;
  outputs: {
    output: IndicatorOutput;
    series: ISeriesApi<SeriesType>;
    push: (time: UTCTimestamp, value: number) => void;
  }[];
  levels: { series: ISeriesApi<SeriesType>; line: IPriceLine }[];
  /** Bars already fed to the series (the replay can rewind). */
  pushed: number;
  barsRef: Bar[];
}

function buildMarkers(sim: Simulator): SeriesMarker<Time>[] {
  const out: SeriesMarker<Time>[] = [];
  for (const t of sim.closed) {
    out.push({
      time: t.openTime as UTCTimestamp,
      position: t.side === "buy" ? "belowBar" : "aboveBar",
      shape: t.side === "buy" ? "arrowUp" : "arrowDown",
      color: t.pnl >= 0 ? "#22c55e" : "#ef4444",
    });
    out.push({
      time: t.closeTime as UTCTimestamp,
      position: t.side === "buy" ? "aboveBar" : "belowBar",
      shape: "square",
      color: t.pnl >= 0 ? "rgba(34,197,94,0.7)" : "rgba(239,68,68,0.7)",
    });
  }
  return out.sort((a, b) => Number(a.time) - Number(b.time));
}

function findBarIndex(bars: Bar[], ts: number): number {
  if (bars.length === 0) return 0;
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].ts < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface StopLineHit {
  scope: "position" | "pending";
  ticket: number;
  field: "sl" | "tp";
  price: number;
}

/** Nearest SL/TP price line under the pointer (regardless of the x, like MT4). */
function hitStopLine(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  sim: Simulator,
  x: number,
  y: number,
): StopLineHit | null {
  const pane = chart.paneSize();
  if (x < 0 || y < 0 || x > pane.width || y > pane.height) return null;
  let best: StopLineHit | null = null;
  let bestDy = 6;
  const consider = (scope: StopLineHit["scope"], ticket: number, field: StopLineHit["field"], price: number | null) => {
    if (price == null) return;
    const py = series.priceToCoordinate(price);
    if (py == null) return;
    const dy = Math.abs(y - py);
    if (dy <= bestDy) {
      bestDy = dy;
      best = { scope, ticket, field, price };
    }
  };
  for (const p of sim.positions) {
    consider("position", p.ticket, "sl", p.sl);
    consider("position", p.ticket, "tp", p.tp);
  }
  for (const o of sim.pendings) {
    consider("pending", o.ticket, "sl", o.sl);
    consider("pending", o.ticket, "tp", o.tp);
  }
  return best;
}

/**
 * Keeps a dragged SL/TP on the valid side of the entry/trigger price, using
 * the same side rules the simulator enforces (buy: SL below, TP above).
 */
function clampStopsPrice(
  sim: Simulator,
  scope: StopLineHit["scope"],
  ticket: number,
  field: StopLineHit["field"],
  price: number,
): number {
  const tick = Math.pow(10, -sim.spec.digits);
  if (scope === "position") {
    const pos = sim.positions.find((p) => p.ticket === ticket);
    if (!pos) return price;
    const below = field === "sl" ? pos.side === "buy" : pos.side === "sell";
    return below ? Math.max(tick, Math.min(price, pos.openPrice - tick)) : Math.max(price, pos.openPrice + tick);
  }
  const order = sim.pendings.find((o) => o.ticket === ticket);
  if (!order) return price;
  const isBuy = order.type === "buy_limit" || order.type === "buy_stop";
  const below = field === "sl" ? isBuy : !isBuy;
  return below ? Math.max(tick, Math.min(price, order.price - tick)) : Math.max(price, order.price + tick);
}

export function Chart() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<MarkersApi | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const pushedRef = useRef(0);
  const loadedRef = useRef<LoadedData | null>(null);
  const markCountRef = useRef(-1);

  const [editorFib, setEditorFib] = useState<number | null>(null);
  const [editorShape, setEditorShape] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ fibId: number; levelRatio?: number; x: number; y: number } | null>(null);
  const [shapeMenu, setShapeMenu] = useState<{ shapeId: number; x: number; y: number } | null>(null);
  /** Bar index under the pointer — drives the OHLCV strip at the chart bottom. */
  const [hoverBar, setHoverBar] = useState<number | null>(null);

  const fibSeq = useRef(1);
  const shapeSeq = useRef(1);
  const fibToolRef = useRef<FibToolKind | null>(null);
  const fibAnchorRef = useRef<FibAnchor | null>(null);
  const fibsRef = useRef<FibDrawing[]>([]);
  const shapesRef = useRef<DrawingShape[]>([]);
  const shapeToolRef = useRef<ShapeToolKind | null>(null);
  const shapeAnchorRef = useRef<ShapePoint | null>(null);
  const indicatorRef = useRef<IndicatorInstance[]>([]);
  const indicatorCachesRef = useRef<Map<number, IndicatorValuesCache>>(new Map());
  const paneRuntimesRef = useRef<PaneSeriesRuntime[]>([]);
  const paneSigRef = useRef<string>("");
  const hoverRef = useRef<HoverPoint | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const posRef = useRef(0);
  const crosshairRef = useRef(false);
  const measureRef = useRef<{ a: MeasurePoint | null; b: MeasurePoint | null; preview: MeasurePoint | null }>({
    a: null,
    b: null,
    preview: null,
  });
  const hoverBarRef = useRef<number | null>(null);

  const loaded = useStore((s) => s.loaded);
  const pos = useStore((s) => s.pos);
  const version = useStore((s) => s.version);
  const sim = useStore((s) => s.sim);
  const running = useStore((s) => s.running);
  const fibs = useStore((s) => s.fibs);
  const fibTool = useStore((s) => s.fibTool);
  const fibAnchor = useStore((s) => s.fibAnchor);
  const setFibTool = useStore((s) => s.setFibTool);
  const setFibAnchor = useStore((s) => s.setFibAnchor);
  const addFib = useStore((s) => s.addFib);
  const updateFib = useStore((s) => s.updateFib);
  const removeFib = useStore((s) => s.removeFib);

  const shapes = useStore((s) => s.shapes);
  const shapeTool = useStore((s) => s.shapeTool);
  const shapeAnchor = useStore((s) => s.shapeAnchor);
  const setShapeTool = useStore((s) => s.setShapeTool);
  const setShapeAnchor = useStore((s) => s.setShapeAnchor);
  const addShape = useStore((s) => s.addShape);
  const updateShape = useStore((s) => s.updateShape);
  const removeShape = useStore((s) => s.removeShape);

  const indicators = useStore((s) => s.indicators);
  const indicatorEditorId = useStore((s) => s.indicatorEditorId);
  const updateIndicator = useStore((s) => s.updateIndicator);
  const removeIndicator = useStore((s) => s.removeIndicator);
  const openIndicatorEditor = useStore((s) => s.openIndicatorEditor);

  const crosshair = useStore((s) => s.crosshair);
  const setCrosshair = useStore((s) => s.setCrosshair);
  const showVolume = useStore((s) => s.showVolume);

  useEffect(() => {
    fibToolRef.current = fibTool;
  }, [fibTool]);
  useEffect(() => {
    fibAnchorRef.current = fibAnchor;
  }, [fibAnchor]);
  useEffect(() => {
    fibsRef.current = fibs;
  }, [fibs]);
  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);
  useEffect(() => {
    shapeToolRef.current = shapeTool;
  }, [shapeTool]);
  useEffect(() => {
    shapeAnchorRef.current = shapeAnchor;
  }, [shapeAnchor]);
  useEffect(() => {
    indicatorRef.current = indicators;
    const ids = new Set(indicators.map((inst) => inst.id));
    for (const id of indicatorCachesRef.current.keys()) {
      if (!ids.has(id)) indicatorCachesRef.current.delete(id);
    }
  }, [indicators]);
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  useEffect(() => {
    crosshairRef.current = crosshair;
    if (!crosshair) measureRef.current = { a: null, b: null, preview: null };
  }, [crosshair]);

  // A fresh dataset invalidates the measured bar indices.
  useEffect(() => {
    measureRef.current = { a: null, b: null, preview: null };
  }, [loaded]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      layout: { background: { color: "#0b1117" }, textColor: "#9fb0c3", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "#141d27" }, horzLines: { color: "#141d27" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1f2a35", scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: "#1f2a35", timeVisible: true, secondsVisible: false, rightOffset: 6 },
      autoSize: true,
    });
    chartRef.current = chart;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    candleRef.current = candles;
    volRef.current = volume;
    markersRef.current = createSeriesMarkers<Time>(candles, []);
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
    };
  }, []);

  // Volume histogram visibility is a chart preference, not replay state.
  useEffect(() => {
    volRef.current?.applyOptions({ visible: showVolume });
  }, [showVolume]);

  // Dev-only inspection hook used by the headless smoke tests.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __chartTest?: unknown }).__chartTest = {
      toX: (t: number) => chartRef.current?.timeScale().timeToCoordinate(t as UTCTimestamp) ?? null,
      toY: (p: number) => candleRef.current?.priceToCoordinate(p) ?? null,
      visibleRange: () => chartRef.current?.timeScale().getVisibleLogicalRange() ?? null,
      pane: () => {
        const size = chartRef.current?.paneSize();
        return size ? { width: size.width, height: size.height } : null;
      },
      maPoint: (id: number, index: number) => {
        const chart = chartRef.current;
        const series = candleRef.current;
        const data = loadedRef.current;
        const inst = indicatorRef.current.find((i) => i.id === id);
        if (!chart || !series || !data || !inst) return null;
        const def = indicatorDef(inst.kind);
        if (def.placement !== "price") return null;
        const spec = getSymbolSpec(data.symbol);
        const count = Math.max(0, Math.min(posRef.current, data.bars.length));
        let cache = indicatorCachesRef.current.get(id);
        if (!cache) {
          cache = createIndicatorValuesCache();
          indicatorCachesRef.current.set(id, cache);
        }
        const values = ensureIndicatorValues(cache, data.bars, indicatorSignature(inst, spec.pipSize), count, () =>
          def.compute(data.bars, count, inst.params, { pipSize: spec.pipSize }),
        );
        const first = indicatorOutputs(inst)[0];
        const value = first ? values[first.key]?.[index] : null;
        if (value == null) return null;
        const x = chart.timeScale().timeToCoordinate(data.bars[index].ts as UTCTimestamp);
        const y = series.priceToCoordinate(value);
        if (x == null || y == null) return null;
        return { x, y, value };
      },
    };
  }, []);

  // Overlay redraw loop while there is something to show.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const paint = () => {
      const m = measureRef.current;
      drawOverlay(
        canvas,
        chartRef.current,
        candleRef.current,
        loadedRef.current,
        posRef.current,
        {
          fibs: fibsRef.current,
          fibAnchor: fibAnchorRef.current,
          fibTool: fibToolRef.current,
          shapes: shapesRef.current,
          shapeTool: shapeToolRef.current,
          shapeAnchor: shapeAnchorRef.current,
          indicators: indicatorRef.current,
          hover: hoverRef.current,
          measure: m.a ? { a: m.a, b: m.b, preview: m.preview } : null,
        },
        indicatorCachesRef.current,
      );
    };
    const active =
      fibs.length > 0 ||
      fibTool !== null ||
      shapes.length > 0 ||
      shapeTool !== null ||
      indicators.length > 0 ||
      crosshair;
    if (!active) {
      paint();
      return;
    }
    let raf = requestAnimationFrame(function loop() {
      paint();
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [fibs.length, fibTool, shapes.length, shapeTool, indicators.length, loaded, crosshair]);

  // Oscillator indicators (RSI, MACD, ATR) in their own panes below the price
  // chart: native series, rebuilt when the list or their settings change.
  useEffect(() => {
    const chart = chartRef.current;
    const data = loadedRef.current;
    if (!chart || !data) {
      paneRuntimesRef.current = [];
      paneSigRef.current = "";
      return;
    }
    const bars = data.bars;
    const paneIndicators = indicators.filter((inst) => indicatorDef(inst.kind).placement === "pane");
    const sig =
      paneIndicators
        .map((inst) => `${inst.id}:${inst.kind}:${JSON.stringify(inst.params)}:${JSON.stringify(inst.colors)}`)
        .join("|") + `|${data.symbol}`;
    const rewound = paneRuntimesRef.current.some((rt) => pos < rt.pushed);
    const barsChanged = paneRuntimesRef.current.some((rt) => rt.barsRef !== bars);
    if (rewound || barsChanged || sig !== paneSigRef.current) {
      for (const rt of paneRuntimesRef.current) {
        for (const level of rt.levels) level.series.removePriceLine(level.line);
        for (const out of rt.outputs) chart.removeSeries(out.series);
      }
      paneRuntimesRef.current = [];
      paneSigRef.current = sig;

      const spec = getSymbolSpec(data.symbol);
      paneIndicators.forEach((inst, n) => {
        const def = indicatorDef(inst.kind);
        const outputs = indicatorOutputs(inst);
        const runtime: PaneSeriesRuntime = { id: inst.id, outputs: [], levels: [], pushed: 0, barsRef: bars };
        for (const out of outputs) {
          const digits = out.digits ?? spec.digits;
          const priceFormat = { type: "price" as const, precision: digits, minMove: Math.pow(10, -digits) };
          const series =
            out.style === "histogram"
              ? chart.addSeries(
                  HistogramSeries,
                  { color: out.color, priceLineVisible: false, priceFormat },
                  n + 1,
                )
              : chart.addSeries(
                  LineSeries,
                  { color: out.color, lineWidth: 2, priceLineVisible: false, priceFormat },
                  n + 1,
                );
          const push =
            out.style === "histogram"
              ? (time: UTCTimestamp, value: number) =>
                  (series as ISeriesApi<"Histogram">).update({
                    time,
                    value,
                    color: value >= 0 ? out.upColor ?? out.color : out.downColor ?? out.color,
                  })
              : (time: UTCTimestamp, value: number) => (series as ISeriesApi<"Line">).update({ time, value });
          runtime.outputs.push({ output: out, series, push });
        }
        const main = runtime.outputs[0];
        if (main) {
          for (const level of def.levels?.(inst.params) ?? []) {
            runtime.levels.push({
              series: main.series,
              line: main.series.createPriceLine({
                price: level.value,
                color: level.color ?? "rgba(148,163,184,0.5)",
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: false,
                title: level.label ?? "",
              }),
            });
          }
        }
        paneRuntimesRef.current.push(runtime);
      });

      // Keep the price pane dominant and share the rest evenly.
      const panes = chart.panes();
      panes[0]?.setStretchFactor(4);
      for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);
    }

    // Feed the bars added since the last step; the values cache is shared
    // with the overlay so each indicator is computed once per replay step.
    const spec = getSymbolSpec(data.symbol);
    for (const rt of paneRuntimesRef.current) {
      if (rt.pushed >= pos) continue;
      const inst = indicators.find((i) => i.id === rt.id);
      if (!inst) continue;
      const def = indicatorDef(inst.kind);
      let cache = indicatorCachesRef.current.get(inst.id);
      if (!cache) {
        cache = createIndicatorValuesCache();
        indicatorCachesRef.current.set(inst.id, cache);
      }
      const values = ensureIndicatorValues(cache, bars, indicatorSignature(inst, spec.pipSize), pos, () =>
        def.compute(bars, pos, inst.params, { pipSize: spec.pipSize }),
      );
      for (let i = rt.pushed; i < pos; i++) {
        const time = bars[i]?.ts;
        if (time == null) break;
        for (const out of rt.outputs) {
          const value = values[out.output.key]?.[i];
          if (value == null) continue;
          out.push(time as UTCTimestamp, value);
        }
      }
      rt.pushed = pos;
    }
  }, [indicators, loaded, pos]);

  // Chart interaction: place points, drag anchors/whole tool, right-click to edit.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const local = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    let down: { x: number; y: number; t: number; maId: number | null } | null = null;
    /** Rubber-band line shown while an SL/TP line is being dragged. */
    let tempStopLine: IPriceLine | null = null;

    const chartPointFromEvent = (e: MouseEvent): ShapePoint | null => {
      const chart = chartRef.current;
      const series = candleRef.current;
      const bars = loadedRef.current?.bars;
      if (!chart || !series || !bars) return null;
      const p = local(e);
      const price = series.coordinateToPrice(p.y);
      if (price == null) return null;
      let timeNum: number | null = null;
      const time = chart.timeScale().coordinateToTime(p.x);
      if (typeof time === "number") timeNum = time;
      else {
        const logical = chart.timeScale().coordinateToLogical(p.x);
        const processed = Math.max(0, Math.min(posRef.current, bars.length));
        if (logical != null && processed > 0) {
          const idx = Math.max(0, Math.min(processed - 1, Math.round(logical)));
          timeNum = bars[idx].ts;
        }
      }
      if (timeNum == null) return null;
      return { time: timeNum, price: Math.max(0.00001, price) };
    };

    // Crosshair ruler: snaps a pointer event to the nearest bar and the price
    // under the cursor, which is what MT4's crosshair reports between clicks.
    const snapMeasurePoint = (e: MouseEvent): MeasurePoint | null => {
      const chart = chartRef.current;
      const series = candleRef.current;
      const bars = loadedRef.current?.bars;
      if (!chart || !series || !bars) return null;
      const processed = Math.max(0, Math.min(posRef.current, bars.length));
      if (processed === 0) return null;
      const p = local(e);
      const pane = chart.paneSize();
      if (p.x < 0 || p.y < 0 || p.x > pane.width || p.y > pane.height) return null;
      const price = series.coordinateToPrice(p.y);
      if (price == null) return null;
      const logical = chart.timeScale().coordinateToLogical(p.x);
      const index = Math.max(0, Math.min(processed - 1, Math.round(logical ?? processed - 1)));
      return { index, time: bars[index].ts, price: Math.max(0.00001, price) };
    };

    // Bar under the pointer, for the OHLCV strip at the bottom of the chart.
    const barIndexAt = (x: number, y: number): number | null => {
      const chart = chartRef.current;
      const bars = loadedRef.current?.bars;
      if (!chart || !bars) return null;
      const processed = Math.max(0, Math.min(posRef.current, bars.length));
      if (processed === 0) return null;
      const pane = chart.paneSize();
      if (x < 0 || y < 0 || x > pane.width || y > pane.height) return null;
      const logical = chart.timeScale().coordinateToLogical(x);
      if (logical == null) return null;
      const index = Math.round(logical);
      return index >= 0 && index <= processed - 1 ? index : null;
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now(), maId: null };
      const chart = chartRef.current;
      const series = candleRef.current;
      const data = loadedRef.current;
      if (!chart || !series || !data || fibToolRef.current || shapeToolRef.current) return;
      const p = local(e);

      // SL/TP lines win over drawings: drag them straight on the chart.
      const simNow = useStore.getState().sim;
      const stopHit = simNow ? hitStopLine(chart, series, simNow, p.x, p.y) : null;
      if (stopHit) {
        e.stopPropagation();
        e.preventDefault();
        dragRef.current = {
          kind: "stops",
          ...stopHit,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        tempStopLine = series.createPriceLine({
          price: stopHit.price,
          color: stopHit.field === "sl" ? "#ef4444" : "#22c55e",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: stopHit.field.toUpperCase(),
        });
        return;
      }

      const fibAnchorHit = hitTestFibAnchor(chart, series, fibsRef.current, p.x, p.y);
      const fibHit = fibAnchorHit ? null : hitTestFib(chart, series, fibsRef.current, p.x, p.y);
      const fibTarget = fibAnchorHit?.fib ?? fibHit?.fib;
      if (fibTarget) {
        e.stopPropagation();
        e.preventDefault();
        dragRef.current = {
          kind: "fib",
          mode: fibAnchorHit ? (fibAnchorHit.side === "a" ? "anchorA" : "anchorB") : "move",
          fib: fibTarget,
          idxA: findBarIndex(data.bars, fibTarget.a.time),
          idxB: findBarIndex(data.bars, fibTarget.b.time),
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        return;
      }

      const shapeHit = hitTestShape(chart, series, shapesRef.current, p.x, p.y);
      if (shapeHit) {
        const shape = shapeHit.shape;
        e.stopPropagation();
        e.preventDefault();
        dragRef.current = {
          kind: "shape",
          mode: shapeHit.anchor === "a" ? "anchorA" : shapeHit.anchor === "b" ? "anchorB" : "move",
          shape,
          idxA: shape.kind === "horizontal" ? 0 : findBarIndex(data.bars, shape.a.time),
          idxB: shape.kind === "trend" && shape.b ? findBarIndex(data.bars, shape.b.time) : 0,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        return;
      }

      // Remember an MA under the press point: clicking it opens its settings.
      down.maId = hitTestIndicator(chart, series, data, posRef.current, indicatorRef.current, indicatorCachesRef.current, p.x, p.y);
    };

    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const hx = e.clientX - r.left;
      const hy = e.clientY - r.top;
      hoverRef.current = hx >= 0 && hy >= 0 && hx <= r.width && hy <= r.height ? { x: hx, y: hy } : null;

      // Live ruler preview while the crosshair is waiting for its second point.
      const measured = measureRef.current;
      if (crosshairRef.current && measured.a != null && measured.b == null) {
        measured.preview = hoverRef.current ? snapMeasurePoint(e) : null;
      } else if (measured.preview != null) {
        measured.preview = null;
      }

      // OHLCV strip follows the bar under the pointer (state changes per bar only).
      const hoverIdx = hoverRef.current ? barIndexAt(hoverRef.current.x, hoverRef.current.y) : null;
      if (hoverIdx !== hoverBarRef.current) {
        hoverBarRef.current = hoverIdx;
        setHoverBar(hoverIdx);
      }

      // Show a resize pointer over draggable SL/TP lines.
      const cursorSim = useStore.getState().sim;
      const cursorChart = chartRef.current;
      const cursorSeries = candleRef.current;
      const overStop =
        hoverRef.current && cursorSim && cursorChart && cursorSeries
          ? hitStopLine(cursorChart, cursorSeries, cursorSim, hoverRef.current.x, hoverRef.current.y) != null
          : false;
      const nextCursor = overStop ? "ns-resize" : "";
      if (el.style.cursor !== nextCursor) el.style.cursor = nextCursor;

      const d = dragRef.current;
      const chart = chartRef.current;
      const series = candleRef.current;
      const data = loadedRef.current;
      if (!d || !chart || !series || !data) return;
      e.stopPropagation();
      e.preventDefault();

      if (d.kind === "stops") {
        const simNow = useStore.getState().sim;
        const price = series.coordinateToPrice(e.clientY - r.top);
        if (!simNow || price == null) return;
        d.price = clampStopsPrice(simNow, d.scope, d.ticket, d.field, price);
        d.moved = true;
        tempStopLine?.applyOptions({ price: d.price });
        return;
      }

      const pNow = series.coordinateToPrice(e.clientY - r.top);
      const pStart = series.coordinateToPrice(d.startY - r.top);
      if (pNow == null || pStart == null) return;
      const priceDelta = pNow - pStart;
      const barSpacing = Math.max(1, chart.timeScale().options().barSpacing);
      const processed = Math.max(0, Math.min(posRef.current, data.bars.length));
      if (processed === 0) return;
      const rawShift = Math.round((e.clientX - d.startX) / barSpacing);
      const clampPrice = (x: number) => Math.max(0.00001, x);

      if (d.kind === "fib") {
        const { fib } = d;
        let shift = rawShift;
        if (d.mode === "move") {
          const minShift = -Math.min(d.idxA, d.idxB);
          const maxShift = processed - 1 - Math.max(d.idxA, d.idxB);
          if (maxShift < minShift) return;
          shift = Math.max(minShift, Math.min(maxShift, shift));
        } else if (d.mode === "anchorA") {
          shift = Math.max(-d.idxA, Math.min(processed - 1 - d.idxA, shift));
        } else {
          shift = Math.max(-d.idxB, Math.min(processed - 1 - d.idxB, shift));
        }
        d.moved = true;
        if (d.mode === "anchorA") {
          updateFib({
            ...fib,
            a: { time: data.bars[d.idxA + shift].ts, price: clampPrice(fib.a.price + priceDelta) },
          });
        } else if (d.mode === "anchorB") {
          updateFib({
            ...fib,
            b: { time: data.bars[d.idxB + shift].ts, price: clampPrice(fib.b.price + priceDelta) },
          });
        } else {
          updateFib({
            ...fib,
            a: { time: data.bars[d.idxA + shift].ts, price: clampPrice(fib.a.price + priceDelta) },
            b: { time: data.bars[d.idxB + shift].ts, price: clampPrice(fib.b.price + priceDelta) },
          });
        }
        return;
      }

      const { shape } = d;
      if (shape.kind === "horizontal") {
        d.moved = true;
        updateShape({ ...shape, a: { ...shape.a, price: clampPrice(shape.a.price + priceDelta) } });
        return;
      }
      if (shape.kind === "vertical") {
        const shift = Math.max(-d.idxA, Math.min(processed - 1 - d.idxA, rawShift));
        d.moved = true;
        updateShape({ ...shape, a: { ...shape.a, time: data.bars[d.idxA + shift].ts } });
        return;
      }
      if (!shape.b) return;
      if (d.mode === "anchorA") {
        const shift = Math.max(-d.idxA, Math.min(processed - 1 - d.idxA, rawShift));
        d.moved = true;
        updateShape({
          ...shape,
          a: { time: data.bars[d.idxA + shift].ts, price: clampPrice(shape.a.price + priceDelta) },
        });
      } else if (d.mode === "anchorB") {
        const shift = Math.max(-d.idxB, Math.min(processed - 1 - d.idxB, rawShift));
        d.moved = true;
        updateShape({
          ...shape,
          b: { time: data.bars[d.idxB + shift].ts, price: clampPrice(shape.b.price + priceDelta) },
        });
      } else {
        const minShift = -Math.min(d.idxA, d.idxB);
        const maxShift = processed - 1 - Math.max(d.idxA, d.idxB);
        if (maxShift < minShift) return;
        const shift = Math.max(minShift, Math.min(maxShift, rawShift));
        d.moved = true;
        updateShape({
          ...shape,
          a: { time: data.bars[d.idxA + shift].ts, price: clampPrice(shape.a.price + priceDelta) },
          b: { time: data.bars[d.idxB + shift].ts, price: clampPrice(shape.b.price + priceDelta) },
        });
      }
    };

    const commitStopDrag = (d: StopsDragState) => {
      const state = useStore.getState();
      const sim = state.sim;
      if (!sim) return;
      if (d.scope === "position") {
        const pos = sim.positions.find((p) => p.ticket === d.ticket);
        if (!pos) return;
        state.modifyPosition(d.ticket, d.field === "sl" ? d.price : pos.sl, d.field === "tp" ? d.price : pos.tp);
      } else {
        state.modifyPending(d.ticket, d.field === "sl" ? { sl: d.price } : { tp: d.price });
      }
    };

    const onUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const d = dragRef.current;
      if (d) {
        dragRef.current = null;
        e.stopPropagation();
        if (tempStopLine) {
          candleRef.current?.removePriceLine(tempStopLine);
          tempStopLine = null;
        }
        if (d.moved) e.preventDefault();
        if (d.kind === "stops") {
          if (d.moved) commitStopDrag(d);
          return;
        }
        return;
      }
      if (!down) return;
      const movedPx = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const heldMs = performance.now() - down.t;
      const maId = down.maId;
      down = null;
      if (movedPx > 6 || heldMs > 600) return;
      const chart = chartRef.current;
      const series = candleRef.current;
      const data = loadedRef.current;
      if (!chart || !series || !data) return;

      const tool = fibToolRef.current;
      if (tool) {
        const point = chartPointFromEvent(e);
        if (!point) return;
        const start = fibAnchorRef.current;
        if (!start) {
          setFibAnchor(point);
          return;
        }
        const kind = tool === "extension" ? "extension" : "retracement";
        addFib({
          id: fibSeq.current++,
          a: start,
          b: point,
          color: FIB_COLOR_BY_KIND[kind],
          levels: fibLevelsFor(kind),
        });
        setFibAnchor(null);
        setFibTool(null);
        return;
      }

      const shapeToolNow = shapeToolRef.current;
      if (shapeToolNow) {
        const point = chartPointFromEvent(e);
        if (!point) return;
        if (shapeToolNow === "trend") {
          const start = shapeAnchorRef.current;
          if (!start) {
            setShapeAnchor(point);
            return;
          }
          addShape({
            id: shapeSeq.current++,
            kind: "trend",
            a: start,
            b: point,
            color: SHAPE_COLOR_BY_KIND.trend,
          });
          setShapeAnchor(null);
          setShapeTool(null);
          return;
        }
        const kind = shapeToolNow === "horizontal" ? "horizontal" : "vertical";
        addShape({ id: shapeSeq.current++, kind, a: point, b: null, color: SHAPE_COLOR_BY_KIND[kind] });
        setShapeTool(null);
        return;
      }

      // Crosshair ruler: the first click anchors point A, the second completes
      // the span (a third click starts a fresh measurement).
      if (crosshairRef.current) {
        const point = snapMeasurePoint(e);
        if (!point) return;
        const m = measureRef.current;
        if (m.a == null || m.b != null) {
          m.a = point;
          m.b = null;
        } else {
          m.b = point;
        }
        m.preview = null;
        return;
      }

      // Clicking a moving-average line opens its settings window.
      if (maId != null) openIndicatorEditor(maId);
    };

    const onContext = (e: MouseEvent) => {
      const chart = chartRef.current;
      const series = candleRef.current;
      const data = loadedRef.current;
      if (!chart || !series || !data) return;
      const p = local(e);

      const fibHit = hitTestFib(chart, series, fibsRef.current, p.x, p.y);
      if (fibHit) {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ fibId: fibHit.fib.id, levelRatio: fibHit.levelRatio, x: e.clientX, y: e.clientY });
        return;
      }

      const shapeHit = hitTestShape(chart, series, shapesRef.current, p.x, p.y);
      if (shapeHit) {
        e.preventDefault();
        e.stopPropagation();
        setShapeMenu({ shapeId: shapeHit.shape.id, x: e.clientX, y: e.clientY });
        return;
      }

      const maId = hitTestIndicator(chart, series, data, posRef.current, indicatorRef.current, indicatorCachesRef.current, p.x, p.y);
      if (maId != null) {
        e.preventDefault();
        e.stopPropagation();
        openIndicatorEditor(maId);
      }
    };

    const onLeave = () => {
      hoverRef.current = null;
      el.style.cursor = "";
      if (hoverBarRef.current !== null) {
        hoverBarRef.current = null;
        setHoverBar(null);
      }
    };

    el.addEventListener("mousedown", onDown, true);
    el.addEventListener("contextmenu", onContext, true);
    el.addEventListener("mousemove", onMove, true);
    el.addEventListener("mouseleave", onLeave);
    window.addEventListener("mouseup", onUp, true);
    return () => {
      if (tempStopLine) {
        candleRef.current?.removePriceLine(tempStopLine);
        tempStopLine = null;
      }
      el.removeEventListener("mousedown", onDown, true);
      el.removeEventListener("contextmenu", onContext, true);
      el.removeEventListener("mousemove", onMove, true);
      el.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("mouseup", onUp, true);
    };
  }, [
    addFib,
    addShape,
    openIndicatorEditor,
    setFibAnchor,
    setFibTool,
    setShapeAnchor,
    setShapeTool,
    updateFib,
    updateShape,
  ]);

  // Escape closes editors / menus and cancels a drawing in progress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) return setMenu(null);
      if (shapeMenu) return setShapeMenu(null);
      if (editorFib != null) return setEditorFib(null);
      if (editorShape != null) return setEditorShape(null);
      if (indicatorEditorId != null) return openIndicatorEditor(null);
      if (fibTool) {
        setFibTool(null);
        setFibAnchor(null);
        return;
      }
      if (shapeTool) {
        setShapeTool(null);
        setShapeAnchor(null);
        return;
      }
      // Crosshair: Esc clears the ruler first, a second Esc leaves the mode.
      // Keystrokes typed into a form field (e.g. the Symbol box) are not ours.
      if (crosshair) {
        const typedInField =
          e.target instanceof HTMLElement &&
          e.target.closest("input, textarea, select, [contenteditable='true']") != null;
        if (!typedInField) {
          const m = measureRef.current;
          if (m.a != null) {
            m.a = null;
            m.b = null;
            m.preview = null;
            return;
          }
          setCrosshair(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    menu,
    shapeMenu,
    editorFib,
    editorShape,
    indicatorEditorId,
    fibTool,
    shapeTool,
    crosshair,
    setFibTool,
    setFibAnchor,
    setShapeTool,
    setShapeAnchor,
    setCrosshair,
    openIndicatorEditor,
  ]);

  // Candles, volume, markers, order/position lines.
  useEffect(() => {
    const chart = chartRef.current;
    const candles = candleRef.current;
    const volume = volRef.current;
    const markers = markersRef.current;
    if (!chart || !candles || !volume || !markers) return;

    if (!loaded) {
      candles.setData([]);
      volume.setData([]);
      markers.setMarkers([]);
      pushedRef.current = 0;
      return;
    }

    const spec = getSymbolSpec(loaded.symbol);
    candles.applyOptions({
      priceFormat: { type: "price", precision: spec.digits, minMove: Math.pow(10, -spec.digits) },
    });

    if (loadedRef.current !== loaded || pushedRef.current > pos) {
      candles.setData([]);
      volume.setData([]);
      markers.setMarkers([]);
      markCountRef.current = -1;
      pushedRef.current = 0;
      for (const line of linesRef.current) candles.removePriceLine(line);
      linesRef.current = [];
    }

    for (let i = pushedRef.current; i < pos; i++) {
      const b = loaded.bars[i];
      candles.update({ time: b.ts as UTCTimestamp, open: b.bid.o, high: b.bid.h, low: b.bid.l, close: b.bid.c });
      volume.update({
        time: b.ts as UTCTimestamp,
        value: b.volume,
        color: b.bid.c >= b.bid.o ? "rgba(34,197,94,0.28)" : "rgba(239,68,68,0.28)",
      });
    }
    pushedRef.current = pos;
    loadedRef.current = loaded;

    if (sim && markCountRef.current !== sim.closed.length) {
      markers.setMarkers(buildMarkers(sim));
      markCountRef.current = sim.closed.length;
    }

    for (const line of linesRef.current) candles.removePriceLine(line);
    linesRef.current = [];
    if (sim) {
      // Pending orders: dashed line at the trigger price with ticket + type,
      // plus their SL/TP lines when the order carries them.
      for (const o of sim.pendings) {
        const isBuy = o.type === "buy_limit" || o.type === "buy_stop";
        linesRef.current.push(
          candles.createPriceLine({
            price: o.price,
            color: isBuy ? "rgba(34,197,94,0.95)" : "rgba(239,68,68,0.95)",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${PENDING_LABELS[o.type]} #${o.ticket}`,
          }),
        );
        if (o.sl != null) {
          linesRef.current.push(
            candles.createPriceLine({
              price: o.sl,
              color: "rgba(239,68,68,0.75)",
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: `SL #${o.ticket}`,
            }),
          );
        }
        if (o.tp != null) {
          linesRef.current.push(
            candles.createPriceLine({
              price: o.tp,
              color: "rgba(34,197,94,0.75)",
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: `TP #${o.ticket}`,
            }),
          );
        }
      }
      // Open positions: entry + SL/TP lines (entry label becomes BUY/SELL on fill).
      for (const p of sim.positions) {
        linesRef.current.push(
          candles.createPriceLine({
            price: p.openPrice,
            color: p.side === "buy" ? "#34a07b" : "#c2724d",
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: `${p.side.toUpperCase()} #${p.ticket} ${p.lots.toFixed(2)}`,
          }),
        );
        if (p.sl != null) {
          linesRef.current.push(
            candles.createPriceLine({
              price: p.sl,
              color: "#ef4444",
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: "SL",
            }),
          );
        }
        if (p.tp != null) {
          linesRef.current.push(
            candles.createPriceLine({
              price: p.tp,
              color: "#22c55e",
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: "TP",
            }),
          );
        }
      }
    }

    if (pos > 0) {
      if (pos <= 60) chart.timeScale().fitContent();
      else if (running) chart.timeScale().scrollToRealTime();
    }
  }, [loaded, pos, version, sim, running]);

  const lastBar = loaded && pos > 0 ? loaded.bars[pos - 1] : null;
  const spec = loaded ? getSymbolSpec(loaded.symbol) : null;

  // Bar data shown in the strip under the cursor (formatted by the chart).
  const hoveredBar =
    loaded && hoverBar != null && hoverBar >= 0 && hoverBar < pos && hoverBar < loaded.bars.length
      ? loaded.bars[hoverBar]
      : null;
  const hoveredPrev = loaded && hoveredBar && hoverBar != null && hoverBar > 0 ? loaded.bars[hoverBar - 1] : null;
  const spreadPips = lastBar && spec ? (lastBar.ask.c - lastBar.bid.c) / spec.pipSize : null;
  const change = lastBar && pos >= 2 && loaded ? lastBar.bid.c - loaded.bars[pos - 2].bid.c : null;

  const editorTarget = editorFib != null ? fibs.find((f) => f.id === editorFib) ?? null : null;
  const shapeTarget = editorShape != null ? shapes.find((s) => s.id === editorShape) ?? null : null;
  const indicatorTarget =
    indicatorEditorId != null ? indicators.find((inst) => inst.id === indicatorEditorId) ?? null : null;
  const shapeMenuTarget = shapeMenu ? shapes.find((s) => s.id === shapeMenu.shapeId) ?? null : null;

  const menuItems: MenuItem[] = [];
  if (menu) {
    const fib = fibs.find((f) => f.id === menu.fibId);
    if (fib && menu.levelRatio != null) {
      const lvl = fib.levels.find((l) => Math.abs(l.ratio - menu.levelRatio!) < 1e-9);
      if (lvl) {
        menuItems.push({
          label: `${lvl.enabled ? "Hide" : "Show"} ${ratioLabel(lvl.ratio)} level`,
          onClick: () => updateFib({ ...fib, levels: toggleLevel(fib.levels, lvl.ratio) }),
        });
      }
    }
    menuItems.push({ label: "Edit levels & colour…", onClick: () => setEditorFib(menu.fibId) });
    menuItems.push({ label: "Remove Fibonacci", danger: true, onClick: () => removeFib(menu.fibId) });
  }

  const shapeMenuItems: MenuItem[] = [];
  if (shapeMenu && shapeMenuTarget) {
    shapeMenuItems.push({ label: "Edit colour…", onClick: () => setEditorShape(shapeMenuTarget.id) });
    shapeMenuItems.push({ label: "Remove line", danger: true, onClick: () => removeShape(shapeMenuTarget.id) });
  }

  return (
    <div className="chart-wrap">
      {loaded && lastBar && spec ? (
        <div className="chart-hud">
          <span className="hud-symbol">{loaded.symbol}</span>
          <span className={`hud-price ${change != null && change < 0 ? "neg" : "pos"}`}>
            {fmtPrice(lastBar.ask.c, spec.digits)}
          </span>
          <span className="hud-meta">
            bid {fmtPrice(lastBar.bid.c, spec.digits)} · ask {fmtPrice(lastBar.ask.c, spec.digits)}
            {spreadPips != null ? ` · spread ${spreadPips.toFixed(1)}p` : ""}
          </span>
          <span className="hud-time">{fmtTime(lastBar.ts)} UTC</span>
        </div>
      ) : null}

      <div ref={containerRef} className={`chart-canvas ${crosshair ? "crosshair-on" : ""}`} />
      <canvas ref={overlayRef} className="chart-overlay" />

      {loaded && spec && hoveredBar ? (
        <div className="chart-data-strip">
          <span className="data-stamp">{fmtTime(hoveredBar.ts)} UTC</span>
          <span>O <b>{fmtPrice(hoveredBar.bid.o, spec.digits)}</b></span>
          <span>H <b>{fmtPrice(hoveredBar.bid.h, spec.digits)}</b></span>
          <span>L <b>{fmtPrice(hoveredBar.bid.l, spec.digits)}</b></span>
          <span>
            C{" "}
            <b className={hoveredPrev && hoveredBar.bid.c < hoveredPrev.bid.c ? "neg" : "pos"}>
              {fmtPrice(hoveredBar.bid.c, spec.digits)}
            </b>
          </span>
          <span>Vol <b>{hoveredBar.volume.toLocaleString()}</b></span>
          {hoveredPrev ? (
            <span className={`data-chg ${hoveredBar.bid.c < hoveredPrev.bid.c ? "neg" : "pos"}`}>
              Δ {fmtSigned(hoveredBar.bid.c - hoveredPrev.bid.c, spec.digits)}
            </span>
          ) : null}
        </div>
      ) : null}

      {!loaded ? (
        <div className="chart-empty">
          <div className="chart-empty-title">No market data</div>
          <div className="chart-empty-sub">
            Load a file downloaded from evtradelabs.com/data (JSON.gz or CSV), or try the built-in demo dataset.
          </div>
        </div>
      ) : pos === 0 ? (
        <div className="chart-empty">
          <div className="chart-empty-title">Ready to replay</div>
          <div className="chart-empty-sub">
            {loaded.bars.length.toLocaleString()} bars loaded · starts {fmtTime(loaded.bars[0].ts)} UTC.
            Press ▶ Play (or ⏭ Step) to begin, then trade from the order panel.
          </div>
        </div>
      ) : null}

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} /> : null}

      {shapeMenu && shapeMenuTarget ? (
        <ContextMenu x={shapeMenu.x} y={shapeMenu.y} items={shapeMenuItems} onClose={() => setShapeMenu(null)} />
      ) : null}

      {editorTarget ? (
        <FibEditor
          fib={editorTarget}
          digits={spec?.digits ?? 5}
          onChange={(updated) => updateFib(updated)}
          onClose={() => setEditorFib(null)}
          onRemove={() => removeFib(editorTarget.id)}
        />
      ) : null}

      {shapeTarget ? (
        <ShapeEditor
          shape={shapeTarget}
          onChange={(updated) => updateShape(updated)}
          onClose={() => setEditorShape(null)}
          onRemove={() => {
            removeShape(shapeTarget.id);
            setEditorShape(null);
          }}
        />
      ) : null}

      {indicatorTarget ? (
        <IndicatorEditor
          key={indicatorTarget.id}
          instance={indicatorTarget}
          onChange={(updated) => updateIndicator(updated)}
          onClose={() => openIndicatorEditor(null)}
          onRemove={() => {
            removeIndicator(indicatorTarget.id);
            openIndicatorEditor(null);
          }}
        />
      ) : null}
    </div>
  );
}
