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
import type { PendingType } from "../engine/types";
import { getSymbolSpec } from "../engine/symbols";
import { fibLevels } from "../lib/fib";
import { fmtPrice, fmtTime } from "../lib/format";

type MarkersApi = ISeriesMarkersPluginApi<Time>;
type FibMode = "first" | "second" | null;

interface Fib {
  id: number;
  a: number;
  b: number;
}

const PENDING_LABELS: Record<PendingType, string> = {
  buy_limit: "BUY LIMIT",
  sell_limit: "SELL LIMIT",
  buy_stop: "BUY STOP",
  sell_stop: "SELL STOP",
};

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

export function Chart() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<MarkersApi | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const pushedRef = useRef(0);
  const loadedRef = useRef<LoadedData | null>(null);
  const markCountRef = useRef(-1);

  // Drawing tool state
  const [fibs, setFibs] = useState<Fib[]>([]);
  const [fibMode, setFibMode] = useState<FibMode>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const fibSeq = useRef(1);
  const fibLinesRef = useRef<IPriceLine[]>([]);
  const fibLoadedRef = useRef<LoadedData | null>(null);
  const fibModeRef = useRef<FibMode>(null);
  const anchorRef = useRef<number | null>(null);

  const loaded = useStore((s) => s.loaded);
  const pos = useStore((s) => s.pos);
  const version = useStore((s) => s.version);
  const sim = useStore((s) => s.sim);
  const running = useStore((s) => s.running);

  const changeFibMode = (mode: FibMode) => {
    fibModeRef.current = mode;
    setFibMode(mode);
  };
  const changeAnchor = (price: number | null) => {
    anchorRef.current = price;
    setAnchor(price);
  };

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

  // ---- Fibonacci: two-click placement on the chart.
  // Native DOM listeners are used instead of chart.subscribeClick because the library
  // swallows a second click within its double-click window when it lands >5px away.
  useEffect(() => {
    const el = containerRef.current;
    const candles = candleRef.current;
    if (!el || !candles) return;
    let downX = 0;
    let downY = 0;
    let downT = 0;
    let pressed = false;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      pressed = true;
      downX = e.clientX;
      downY = e.clientY;
      downT = performance.now();
    };
    const onUp = (e: MouseEvent) => {
      if (!pressed || e.button !== 0) return;
      pressed = false;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved > 6 || performance.now() - downT > 600) return; // it was a drag, not a click
      const mode = fibModeRef.current;
      if (!mode) return;
      const rect = el.getBoundingClientRect();
      const price = candles.coordinateToPrice(e.clientY - rect.top);
      if (price == null) return;
      if (mode === "first") {
        changeAnchor(price);
        changeFibMode("second");
        return;
      }
      const a = anchorRef.current;
      if (a == null) return;
      setFibs((fs) => [...fs, { id: fibSeq.current++, a, b: price }]);
      changeAnchor(null);
      changeFibMode(null);
    };
    el.addEventListener("mousedown", onDown);
    el.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("mousedown", onDown);
      el.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ---- Escape cancels an in-progress fib
  useEffect(() => {
    if (!fibMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        changeFibMode(null);
        changeAnchor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fibMode]);

  // ---- render fib levels (independent of replay position lines)
  useEffect(() => {
    const candles = candleRef.current;
    if (!candles) return;
    for (const line of fibLinesRef.current) candles.removePriceLine(line);
    fibLinesRef.current = [];

    if (fibLoadedRef.current !== loaded) {
      fibLoadedRef.current = loaded;
      if (fibs.length > 0) setFibs([]);
      if (fibMode) changeFibMode(null);
      if (anchorRef.current != null) changeAnchor(null);
      return;
    }
    if (!loaded) return;
    const spec = getSymbolSpec(loaded.symbol);
    const add = (price: number, color: string, title: string, width: 1 | 2 = 1) => {
      fibLinesRef.current.push(
        candles.createPriceLine({
          price,
          color,
          lineWidth: width,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title,
        }),
      );
    };
    for (const fib of fibs) {
      for (const lvl of fibLevels(fib.a, fib.b)) {
        const color = lvl.golden ? "#f59e0b" : lvl.ratio === 0.5 ? "#a78bfa" : "#22d3ee";
        add(lvl.price, color, `${lvl.label} ${lvl.price.toFixed(spec.digits)}`, lvl.golden ? 2 : 1);
      }
    }
    if (fibMode === "second" && anchorRef.current != null) {
      add(anchorRef.current, "#f59e0b", `0% ${anchorRef.current.toFixed(spec.digits)} — click 2nd point`, 2);
    }
  }, [fibs, fibMode, anchor, loaded]);

  // ---- candles, volume, trade markers, order/position price lines
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
      changeFibMode(null);
      changeAnchor(null);
      return;
    }
    changeAnchor(null);
    changeFibMode("first");
  };

  const clearFibs = () => {
    setFibs([]);
    changeFibMode(null);
    changeAnchor(null);
  };

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
          title="Click two swing points to draw Fibonacci retracement levels (Esc cancels)"
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
    </div>
  );
}
