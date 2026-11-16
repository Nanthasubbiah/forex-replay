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
  DEFAULT_FIB_COLOR,
  defaultFibLevels,
  distToSegment,
  fibPrice,
  ratioLabel,
  type FibAnchor,
  type FibDrawing,
} from "../lib/fib";
import { hexToRgba } from "../lib/color";
import { FibEditor } from "./FibEditor";
import { ContextMenu } from "./ContextMenu";
import { fmtPrice, fmtTime } from "../lib/format";

type MarkersApi = ISeriesMarkersPluginApi<Time>;
type FibMode = "first" | "second" | null;

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

/** Returns the topmost fib under the pointer (diagonal, anchors, or level segments). */
function hitTestFib(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  fibs: FibDrawing[],
  x: number,
  y: number,
): FibDrawing | null {
  const halfBar = Math.max(6, chart.timeScale().options().barSpacing / 2);
  const diagTolerance = Math.max(9, halfBar);
  const anchorTolerance = Math.max(10, halfBar + 2);
  for (let i = fibs.length - 1; i >= 0; i--) {
    const fib = fibs[i];
    const g = fibGeometry(chart, series, fib);
    if (!g) continue;
    if (distToSegment(x, y, g.xA, g.yA, g.xB, g.yB) <= diagTolerance) return fib;
    if (Math.hypot(x - g.xA, y - g.yA) <= anchorTolerance || Math.hypot(x - g.xB, y - g.yB) <= anchorTolerance) return fib;
    if (x >= Math.min(g.xA, g.xB) - 3 && x <= Math.max(g.xA, g.xB) + 3) {
      for (const lvl of fib.levels) {
        if (!lvl.enabled) continue;
        const ly = series.priceToCoordinate(fibPrice(fib.a.price, fib.b.price, lvl.ratio));
        if (ly != null && Math.abs(y - ly) <= 5) return fib;
      }
    }
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
  fibMode: FibMode,
  anchor: FibAnchor | null,
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

  if (fibMode === "second" && anchor != null) {
    const y = series.priceToCoordinate(anchor.price);
    if (y != null) {
      ctx.save();
      ctx.strokeStyle = "rgba(245,158,11,0.9)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#f59e0b";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`0% ${anchor.price.toFixed(digits)} — click swing point 2`, 8, y - 2);
      ctx.restore();
    }
  }
}

interface DragState {
  fib: FibDrawing;
  idxA: number;
  idxB: number;
  startX: number;
  startY: number;
  moved: boolean;
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

  // Fibonacci state
  const [fibs, setFibs] = useState<FibDrawing[]>([]);
  const [fibMode, setFibMode] = useState<FibMode>(null);
  const [anchor, setAnchor] = useState<FibAnchor | null>(null);
  const [editorFib, setEditorFib] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ fibId: number; x: number; y: number } | null>(null);
  const fibSeq = useRef(1);
  const fibLoadedRef = useRef<LoadedData | null>(null);
  const fibModeRef = useRef<FibMode>(null);
  const anchorRef = useRef<FibAnchor | null>(null);
  const fibsRef = useRef<FibDrawing[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const posRef = useRef(0);

  const loaded = useStore((s) => s.loaded);
  const pos = useStore((s) => s.pos);
  const version = useStore((s) => s.version);
  const sim = useStore((s) => s.sim);
  const running = useStore((s) => s.running);

  useEffect(() => {
    fibModeRef.current = fibMode;
  }, [fibMode]);
  useEffect(() => {
    anchorRef.current = anchor;
  }, [anchor]);
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

  // New dataset resets drawings.
  useEffect(() => {
    if (fibLoadedRef.current === loaded) return;
    fibLoadedRef.current = loaded;
    setFibs([]);
    setFibMode(null);
    setAnchor(null);
    setEditorFib(null);
    setMenu(null);
  }, [loaded]);

  // Overlay redraw loop while there is something to show.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const loop = () => {
      drawOverlay(canvas, chartRef.current, candleRef.current, loadedRef.current, fibsRef.current, fibModeRef.current, anchorRef.current);
      return requestAnimationFrame(loop);
    };
    if (fibs.length === 0 && fibMode === null) {
      drawOverlay(canvas, chartRef.current, candleRef.current, loadedRef.current, [], null, null);
      return;
    }
    let raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fibs.length, fibMode, loaded]);

  // Chart interaction: place points, drag the whole tool, right-click to edit.
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
      if (!chart || !series || !data || fibModeRef.current) return;
      const p = local(e);
      const fib = hitTestFib(chart, series, fibsRef.current, p.x, p.y);
      if (!fib) return;
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = {
        fib,
        idxA: findBarIndex(data.bars, fib.a.time),
        idxB: findBarIndex(data.bars, fib.b.time),
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
      let shift = Math.round((e.clientX - d.startX) / barSpacing);
      const processed = Math.max(0, Math.min(posRef.current, data.bars.length));
      const maxShift = processed - 1 - Math.max(d.idxA, d.idxB);
      const minShift = -Math.min(d.idxA, d.idxB);
      if (maxShift < minShift) return;
      shift = Math.max(minShift, Math.min(maxShift, shift));
      const timeA = data.bars[d.idxA + shift].ts;
      const timeB = data.bars[d.idxB + shift].ts;
      const { fib } = d;
      d.moved = true;
      setFibs((fs) =>
        fs.map((f) =>
          f.id === fib.id
            ? {
                ...f,
                a: { time: timeA, price: Math.max(0.00001, fib.a.price + priceDelta) },
                b: { time: timeB, price: Math.max(0.00001, fib.b.price + priceDelta) },
              }
            : f,
        ),
      );
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
      const mode = fibModeRef.current;
      if (!mode) return;
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
      if (mode === "first") {
        setAnchor(point);
        setFibMode("second");
        return;
      }
      const a = anchorRef.current;
      if (!a) return;
      setFibs((fs) => [
        ...fs,
        { id: fibSeq.current++, a, b: point, color: DEFAULT_FIB_COLOR, levels: defaultFibLevels() },
      ]);
      setAnchor(null);
      setFibMode(null);
    };

    const onContext = (e: MouseEvent) => {
      const chart = chartRef.current;
      const series = candleRef.current;
      if (!chart || !series) return;
      const p = local(e);
      const fib = hitTestFib(chart, series, fibsRef.current, p.x, p.y);
      if (!fib) return;
      e.preventDefault();
      e.stopPropagation();
      setMenu({ fibId: fib.id, x: e.clientX, y: e.clientY });
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
  }, []);

  // Escape closes the editor / cancels a drawing in progress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) return setMenu(null);
      if (editorFib != null) return setEditorFib(null);
      if (fibMode) {
        setFibMode(null);
        setAnchor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, editorFib, fibMode]);

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

  const startFib = () => {
    if (!loaded) return;
    if (fibMode) {
      setFibMode(null);
      setAnchor(null);
      return;
    }
    setAnchor(null);
    setFibMode("first");
  };

  const clearFibs = () => {
    setFibs([]);
    setFibMode(null);
    setAnchor(null);
    setEditorFib(null);
  };

  const editorTarget = editorFib != null ? fibs.find((f) => f.id === editorFib) ?? null : null;

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

      <div className="chart-tools">
        <button
          className={`tool-btn ${fibMode ? "active" : ""}`}
          onClick={startFib}
          disabled={!loaded || pos === 0}
          title="Click two swing points to draw Fibonacci; drag the line to move it; right-click the diagonal to edit levels and colour (Esc cancels)"
        >
          {fibMode ? "✕ Fib" : "Fibonacci"}
        </button>
        <button className="tool-btn" onClick={clearFibs} disabled={fibs.length === 0} title="Remove all fib drawings">
          Clear
        </button>
        {fibs.length > 0 ? <span className="tool-chip">{fibs.length} fib</span> : null}
        {fibMode === "first" ? <span className="tool-hint">click swing point 1</span> : null}
        {fibMode === "second" ? <span className="tool-hint">click swing point 2</span> : null}
      </div>

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

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { label: "Edit levels & colour…", onClick: () => setEditorFib(menu.fibId) },
            { label: "Remove Fibonacci", danger: true, onClick: () => setFibs((fs) => fs.filter((f) => f.id !== menu.fibId)) },
          ]}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {editorTarget ? (
        <FibEditor
          fib={editorTarget}
          digits={spec?.digits ?? 5}
          onChange={(updated) => setFibs((fs) => fs.map((f) => (f.id === updated.id ? updated : f)))}
          onClose={() => setEditorFib(null)}
          onRemove={() => setFibs((fs) => fs.filter((f) => f.id !== editorTarget.id))}
        />
      ) : null}
    </div>
  );
}
