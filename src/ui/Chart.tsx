import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useStore } from "../store";
import type { LoadedData } from "../store";
import type { Simulator } from "../engine/simulator";
import type { Bar, PendingType } from "../engine/types";
import { getSymbolSpec } from "../engine/symbols";
import {
  distToSegment,
  FIB_COLOR_BY_KIND,
  fibLevelsFor,
  fibPrice,
  ratioLabel,
  toggleLevel,
  type FibAnchor,
  type FibDrawing,
} from "../lib/fib";
import { hexToRgba } from "../lib/color";
import { FibEditor } from "./FibEditor";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { fmtPrice, fmtTime } from "../lib/format";

type MarkersApi = ISeriesMarkersPluginApi<Time>;

const PENDING_LABELS: Record<PendingType, string> = {
  buy_limit: "BUY LIMIT",
  sell_limit: "SELL LIMIT",
  buy_stop: "BUY STOP",
  sell_stop: "SELL STOP",
};

interface FibGeometry {
  xA: number;
  xB: number;
  yA: number;
  yB: number;
}

interface FibHit {
  fib: FibDrawing;
  /** Set when the pointer is over a horizontal level segment. */
  levelRatio?: number;
}

interface DragState {
  mode: "move" | "anchorA" | "anchorB";
  fib: FibDrawing;
  idxA: number;
  idxB: number;
  startX: number;
  startY: number;
  moved: boolean;
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

function hitTestFib(
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

function hitAnchorHandle(
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
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
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

function drawOverlay(
  canvas: HTMLCanvasElement,
  chart: IChartApi | null,
  series: ISeriesApi<"Candlestick"> | null,
  data: LoadedData | null,
  fibs: FibDrawing[],
  anchor: FibAnchor | null,
  toolColor: string,
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

  const digits = getSymbolSpec(data.symbol).digits;
  for (const fib of fibs) {
    const g = fibGeometry(chart, series, fib);
    if (g) drawFib(ctx, series, fib, g, digits);
  }

  if (anchor != null) {
    const y = series.priceToCoordinate(anchor.price);
    if (y != null) {
      ctx.save();
      ctx.strokeStyle = hexToRgba(toolColor, 0.9);
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = toolColor;
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`0% ${anchor.price.toFixed(digits)} — click swing point 2`, 8, y - 2);
      ctx.restore();
    }
  }
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
  const [menu, setMenu] = useState<{ fibId: number; levelRatio?: number; x: number; y: number } | null>(null);
  const fibSeq = useRef(1);
  const fibToolRef = useRef<string | null>(null);
  const fibAnchorRef = useRef<FibAnchor | null>(null);
  const fibsRef = useRef<FibDrawing[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const posRef = useRef(0);

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
    posRef.current = pos;
  }, [pos]);

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

  // Dev-only inspection hook used by the headless smoke tests.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __chartTest?: unknown }).__chartTest = {
      toX: (t: number) => chartRef.current?.timeScale().timeToCoordinate(t as UTCTimestamp) ?? null,
      toY: (p: number) => candleRef.current?.priceToCoordinate(p) ?? null,
    };
  }, []);

  // Overlay redraw loop while there is something to show.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const loop = () => {
      drawOverlay(
        canvas,
        chartRef.current,
        candleRef.current,
        loadedRef.current,
        fibsRef.current,
        fibAnchorRef.current,
        fibToolRef.current ? FIB_COLOR_BY_KIND[fibToolRef.current as keyof typeof FIB_COLOR_BY_KIND] : "#2dd4bf",
      );
      return requestAnimationFrame(loop);
    };
    if (fibs.length === 0 && fibTool === null) {
      drawOverlay(canvas, chartRef.current, candleRef.current, loadedRef.current, [], null, "#2dd4bf");
      return;
    }
    let raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fibs.length, fibTool, loaded]);

  // Chart interaction: place points, drag anchors/whole tool, right-click to edit.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const local = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    let down: { x: number; y: number; t: number } | null = null;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      const chart = chartRef.current;
      const series = candleRef.current;
      const data = loadedRef.current;
      if (!chart || !series || !data || fibToolRef.current) return;
      const p = local(e);
      const anchorHit = hitAnchorHandle(chart, series, fibsRef.current, p.x, p.y);
      const hit = anchorHit ? null : hitTestFib(chart, series, fibsRef.current, p.x, p.y);
      const target = anchorHit?.fib ?? hit?.fib;
      if (!target) return;
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = {
        mode: anchorHit ? (anchorHit.side === "a" ? "anchorA" : "anchorB") : "move",
        fib: target,
        idxA: findBarIndex(data.bars, target.a.time),
        idxB: findBarIndex(data.bars, target.b.time),
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
    };

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      const chart = chartRef.current;
      const series = candleRef.current;
      const data = loadedRef.current;
      if (!d || !chart || !series || !data) return;
      e.stopPropagation();
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const pNow = series.coordinateToPrice(e.clientY - r.top);
      const pStart = series.coordinateToPrice(d.startY - r.top);
      if (pNow == null || pStart == null) return;
      const priceDelta = pNow - pStart;
      const barSpacing = Math.max(1, chart.timeScale().options().barSpacing);
      const processed = Math.max(0, Math.min(posRef.current, data.bars.length));
      if (processed === 0) return;
      let shift = Math.round((e.clientX - d.startX) / barSpacing);
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
      const clampPrice = (x: number) => Math.max(0.00001, x);
      const { fib } = d;
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
    };

    const onUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const d = dragRef.current;
      if (d) {
        dragRef.current = null;
        e.stopPropagation();
        if (d.moved) e.preventDefault();
        return;
      }
      if (!down) return;
      const movedPx = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const heldMs = performance.now() - down.t;
      down = null;
      if (movedPx > 6 || heldMs > 600) return;
      const tool = fibToolRef.current;
      if (!tool) return;
      const chart = chartRef.current;
      const series = candleRef.current;
      if (!chart || !series) return;
      const p = local(e);
      const price = series.coordinateToPrice(p.y);
      if (price == null) return;
      let timeNum: number | null = null;
      const time = chart.timeScale().coordinateToTime(p.x);
      if (typeof time === "number") timeNum = time;
      else {
        const logical = chart.timeScale().coordinateToLogical(p.x);
        const bars = loadedRef.current?.bars ?? [];
        const processed = Math.max(0, Math.min(posRef.current, bars.length));
        if (logical != null && processed > 0) {
          const idx = Math.max(0, Math.min(processed - 1, Math.round(logical)));
          timeNum = bars[idx].ts;
        }
      }
      if (timeNum == null) return;
      const point: FibAnchor = { time: timeNum, price };
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
    };

    const onContext = (e: MouseEvent) => {
      const chart = chartRef.current;
      const series = candleRef.current;
      if (!chart || !series) return;
      const p = local(e);
      const hit = hitTestFib(chart, series, fibsRef.current, p.x, p.y);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      setMenu({ fibId: hit.fib.id, levelRatio: hit.levelRatio, x: e.clientX, y: e.clientY });
    };

    el.addEventListener("mousedown", onDown, true);
    el.addEventListener("contextmenu", onContext, true);
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
    return () => {
      el.removeEventListener("mousedown", onDown, true);
      el.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
    };
  }, [addFib, setFibAnchor, setFibTool, updateFib]);

  // Escape closes the editor / cancels a drawing in progress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) return setMenu(null);
      if (editorFib != null) return setEditorFib(null);
      if (fibTool) {
        setFibTool(null);
        setFibAnchor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, editorFib, fibTool, setFibTool, setFibAnchor]);

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
      // Pending orders: dashed line at the trigger price with ticket + type.
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
  const spreadPips = lastBar && spec ? (lastBar.ask.c - lastBar.bid.c) / spec.pipSize : null;
  const change = lastBar && pos >= 2 && loaded ? lastBar.bid.c - loaded.bars[pos - 2].bid.c : null;

  const editorTarget = editorFib != null ? fibs.find((f) => f.id === editorFib) ?? null : null;

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

      <div ref={containerRef} className="chart-canvas" />
      <canvas ref={overlayRef} className="chart-overlay" />

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

      {editorTarget ? (
        <FibEditor
          fib={editorTarget}
          digits={spec?.digits ?? 5}
          onChange={(updated) => updateFib(updated)}
          onClose={() => setEditorFib(null)}
          onRemove={() => removeFib(editorTarget.id)}
        />
      ) : null}
    </div>
  );
}
