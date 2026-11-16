import { create } from "zustand";
import { Simulator } from "./engine/simulator";
import type { SimulatorConfig } from "./engine/simulator";
import type { Bar, PendingType, Side } from "./engine/types";
import { generateDemoBars } from "./data/demo";
import { parseDataFile } from "./data/parse";
import { SmaCrossStrategy } from "./strategy/builtin";
import { getSymbolSpec, isValidSymbol, normalizeSymbol } from "./engine/symbols";
import type { FibAnchor, FibDrawing, FibToolKind } from "./lib/fib";
import { createIndicatorInstance, type IndicatorInstance, type IndicatorKind } from "./lib/indicatorRegistry";
import type { DrawingShape, ShapePoint, ShapeToolKind } from "./lib/shapes";

export interface AccountSettings {
  initialBalance: number;
  leverage: number;
  stopOutLevel: number;
  commissionPerLot: number;
  slippagePips: number;
  assumeSpreadPips: number;
}

export const DEFAULT_SETTINGS: AccountSettings = {
  initialBalance: 10_000,
  leverage: 100,
  stopOutLevel: 50,
  commissionPerLot: 0,
  slippagePips: 0,
  assumeSpreadPips: 1,
};

export interface LoadedData {
  symbol: string;
  bars: Bar[];
  sourceName: string;
}

export type StrategyKind = "sma";

export interface Toast {
  kind: "error" | "warning" | "success";
  message: string;
}

interface State {
  loaded: LoadedData | null;
  /** Symbol code for the replay: the one loaded, or the one the next load uses. */
  symbol: string;
  /** Number of bars already processed by the simulato. */
  pos: number;
  running: boolean;
  speed: number;
  sim: Simulator | null;
  settings: AccountSettings;
  version: number;
  strategyKind: StrategyKind | null;
  toast: Toast | null;
  fibs: FibDrawing[];
  fibTool: FibToolKind | null;
  fibAnchor: FibAnchor | null;
  shapes: DrawingShape[];
  shapeTool: ShapeToolKind | null;
  shapeAnchor: ShapePoint | null;
  indicators: IndicatorInstance[];
  indicatorEditorId: number | null;
  /** MT4-style crosshair measure mode: two clicks read bars & pip/point distance. */
  crosshair: boolean;
  /** Draw the volume histogram under the candles. */
  showVolume: boolean;

  loadDemo: () => void;
  loadFile: (file: File) => Promise<void>;
  loadBars: (symbol: string, bars: Bar[], sourceName: string) => void;
  /** Sets the replay symbol; with data loaded it re-labels the bars in place. */
  setSymbol: (symbol: string) => boolean;
  reset: () => void;
  step: () => void;
  play: () => void;
  pause: () => void;
  setSpeed: (n: number) => void;
  backtestToEnd: () => void;
  setStrategy: (kind: StrategyKind | null) => void;
  updateSettings: (patch: Partial<AccountSettings>) => void;

  /** `sl`/`tp` are absolute prices; pass `null` to leave them unset. */
  buyMarket: (side: Side, lots: number, sl: number | null, tp: number | null) => void;
  /** `sl`/`tp` are absolute prices; pass `null` to leave them unset. */
  placePending: (type: PendingType, lots: number, price: number, sl: number | null, tp: number | null) => void;
  closeTicket: (ticket: number) => void;
  closeAll: () => void;
  cancelPending: (ticket: number) => void;
  modifyPosition: (ticket: number, sl: number | null, tp: number | null) => boolean;
  modifyPending: (ticket: number, patch: { price?: number | null; sl?: number | null; tp?: number | null }) => boolean;
  setToast: (toast: Toast | null) => void;

  setFibTool: (tool: FibToolKind | null) => void;
  setFibAnchor: (anchor: FibAnchor | null) => void;
  addFib: (fib: FibDrawing) => void;
  updateFib: (updated: FibDrawing) => void;
  removeFib: (id: number) => void;
  clearDrawings: () => void;

  setShapeTool: (tool: ShapeToolKind | null) => void;
  setShapeAnchor: (anchor: ShapePoint | null) => void;
  addShape: (shape: DrawingShape) => void;
  updateShape: (updated: DrawingShape) => void;
  removeShape: (id: number) => void;

  addIndicator: (kind: IndicatorKind) => void;
  updateIndicator: (updated: IndicatorInstance) => void;
  removeIndicator: (id: number) => void;
  clearIndicators: () => void;
  openIndicatorEditor: (id: number | null) => void;

  setCrosshair: (on: boolean) => void;
  setShowVolume: (on: boolean) => void;
}

let timer: ReturnType<typeof setInterval> | null = null;
let indicatorSeq = 1;

function stopTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function simConfig(settings: AccountSettings): SimulatorConfig {
  return {
    initialBalance: settings.initialBalance,
    leverage: settings.leverage,
    stopOutLevel: settings.stopOutLevel,
    commissionPerLot: settings.commissionPerLot,
    slippagePips: settings.slippagePips,
  };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isAtEnd(loaded: LoadedData, pos: number): boolean {
  return pos >= loaded.bars.length;
}

export const useStore = create<State>((set, get) => ({
  loaded: null,
  symbol: "EURUSD",
  pos: 0,
  running: false,
  speed: 10,
  sim: null,
  settings: DEFAULT_SETTINGS,
  version: 0,
  strategyKind: null,
  toast: null,
  fibs: [],
  fibTool: null,
  fibAnchor: null,
  shapes: [],
  shapeTool: null,
  shapeAnchor: null,
  indicators: [],
  indicatorEditorId: null,
  crosshair: false,
  showVolume: true,

  loadDemo: () => {
    const symbol = get().symbol;
    const bars = generateDemoBars({ symbol, count: 6000, tfMinutes: 5 });
    get().loadBars(symbol, bars, `Demo — ${symbol} M5, synthetic`);
    set({ toast: { kind: "success", message: `Demo ${symbol} M5 loaded — press Play or Backtest.` } });
  },

  loadFile: async (file) => {
    try {
      const parsed = await parseDataFile(file, { assumeSpreadPips: get().settings.assumeSpreadPips });
      // A symbol in the filename wins; otherwise the chart keeps the symbol the
      // user picked (and they can re-label it afterwards).
      const symbol = parsed.symbol ?? get().symbol;
      get().loadBars(symbol, parsed.bars, `${file.name} — ${parsed.bars.length.toLocaleString()} bars`);
      const warnings = parsed.warnings.length > 0 ? ` ${parsed.warnings.join(" ")}` : "";
      const hint = parsed.symbol
        ? ""
        : ` No symbol in the file name — using ${symbol}; edit the Symbol box to change it.`;
      set({
        toast: { kind: "success", message: `Loaded ${symbol} (${parsed.bars.length.toLocaleString()} bars).${warnings}${hint}` },
      });
    } catch (e) {
      set({ toast: { kind: "error", message: `${file.name}: ${errText(e)}` } });
    }
  },

  loadBars: (symbol, bars, sourceName) => {
    stopTimer();
    const sim = new Simulator({ symbol, bars, config: simConfig(get().settings) });
    set({
      loaded: { symbol, bars, sourceName },
      symbol,
      sim,
      pos: 0,
      running: false,
      strategyKind: null,
      fibs: [],
      fibTool: null,
      fibAnchor: null,
      shapes: [],
      shapeTool: null,
      shapeAnchor: null,
      version: get().version + 1,
      toast: null,
    });
  },

  setSymbol: (raw) => {
    const symbol = normalizeSymbol(raw);
    if (!isValidSymbol(symbol)) {
      set({
        toast: {
          kind: "error",
          message: `"${raw.trim()}" is not a usable symbol code — use 2–16 letters or digits, e.g. GBPUSD.`,
        },
      });
      return false;
    }
    const { loaded, settings } = get();
    const previous = get().symbol;
    if (!loaded || loaded.symbol === symbol) {
      // Nothing loaded yet (or the data is already labelled this way): the code
      // simply becomes the symbol the next load will use.
      set({ symbol });
      if (!loaded && symbol !== previous) {
        set({ toast: { kind: "success", message: `Symbol set to ${symbol} — Load data or Demo data will use it.` } });
      }
      return true;
    }
    // Same bars, new identity: rebuild the simulator (pip size, contract size and
    // digits come from the symbol) and restart the replay, but keep the drawings.
    stopTimer();
    const sim = new Simulator({ symbol, bars: loaded.bars, config: simConfig(settings) });
    const spec = getSymbolSpec(symbol);
    // Keep the "source" chip truthful: "Demo — EURUSD M5, synthetic" → GBPUSD.
    const sourceName = loaded.sourceName.includes(loaded.symbol)
      ? loaded.sourceName.split(loaded.symbol).join(symbol)
      : loaded.sourceName;
    set({
      symbol,
      loaded: { ...loaded, symbol, sourceName },
      sim,
      pos: 0,
      running: false,
      strategyKind: null,
      version: get().version + 1,
      toast: {
        kind: "success",
        message: `Symbol set to ${symbol} (${spec.description}) — replay restarted from bar 1 with the new contract specs.`,
      },
    });
    return true;
  },

  reset: () => {
    const { sim } = get();
    stopTimer();
    sim?.reset();
    set({ pos: 0, running: false, version: get().version + 1 });
  },

  step: () => {
    const { loaded, sim, pos } = get();
    if (!loaded || !sim) return;
    if (pos >= loaded.bars.length) {
      stopTimer();
      set({ running: false });
      return;
    }
    try {
      sim.step(pos);
    } catch (e) {
      stopTimer();
      set({ running: false, toast: { kind: "error", message: errText(e) }, version: get().version + 1 });
      return;
    }
    const nextPos = pos + 1;
    const done = nextPos >= loaded.bars.length;
    if (done) stopTimer();
    set({ pos: nextPos, running: done ? false : get().running, version: get().version + 1 });
  },

  play: () => {
    const { loaded, pos } = get();
    if (!loaded || isAtEnd(loaded, pos)) return;
    stopTimer();
    set({ running: true });
    const delay = Math.max(1000 / get().speed, 16);
    timer = setInterval(() => get().step(), delay);
  },

  pause: () => {
    stopTimer();
    set({ running: false });
  },

  setSpeed: (speed) => {
    set({ speed });
    if (get().running) {
      stopTimer();
      timer = setInterval(() => get().step(), Math.max(1000 / speed, 16));
    }
  },

  backtestToEnd: () => {
    const { loaded, sim } = get();
    if (!loaded || !sim) return;
    stopTimer();
    try {
      while (sim.processedBars < loaded.bars.length) sim.step(sim.processedBars);
    } catch (e) {
      set({ running: false, toast: { kind: "error", message: errText(e) }, version: get().version + 1 });
      return;
    }
    set({ pos: loaded.bars.length, running: false, version: get().version + 1 });
    const n = sim.closed.length;
    set({ toast: { kind: "success", message: `Backtest complete — ${n} trade${n === 1 ? "" : "s"} closed.` } });
  },

  setStrategy: (kind) => {
    const { sim, loaded } = get();
    if (!sim || !loaded) return;
    stopTimer();
    sim.reset();
    if (kind === "sma") {
      sim.attachStrategy(new SmaCrossStrategy({ fast: 20, slow: 50, lots: 0.1 }));
    } else {
      sim.attachStrategy(null);
    }
    set({ strategyKind: kind, pos: 0, running: false, version: get().version + 1 });
    if (kind === "sma") {
      set({ toast: { kind: "success", message: "SMA Crossover attached — press Backtest to run it to completion." } });
    }
  },

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    const { loaded } = get();
    if (loaded) {
      // Recreate the simulator so account-level changes apply cleanly.
      get().loadBars(loaded.symbol, loaded.bars, loaded.sourceName);
    }
  },

  buyMarket: (side, lots, sl, tp) => {
    const { sim, loaded } = get();
    if (!sim || !loaded) return;
    const bar = sim.currentBar();
    if (!bar) {
      set({ toast: { kind: "warning", message: "Press Play or Step to start the replay first — market orders need a live price." } });
      return;
    }
    try {
      sim.marketOrder(side, lots, { sl, tp, comment: "manual" });
      set({ version: get().version + 1, toast: null });
    } catch (e) {
      set({ toast: { kind: "error", message: errText(e) } });
    }
  },

  placePending: (type, lots, price, sl, tp) => {
    const { sim, loaded } = get();
    if (!sim || !loaded) return;
    if (!sim.currentBar()) {
      set({ toast: { kind: "warning", message: "Start the replay before placing pending orders." } });
      return;
    }
    try {
      sim.placePending(type, lots, price, { sl, tp });
      set({ version: get().version + 1, toast: null });
    } catch (e) {
      set({ toast: { kind: "error", message: errText(e) } });
    }
  },

  closeTicket: (ticket) => {
    const { sim } = get();
    if (!sim) return;
    sim.closePosition(ticket, "manual");
    set({ version: get().version + 1 });
  },

  closeAll: () => {
    const { sim } = get();
    if (!sim) return;
    sim.closeAllPositions("manual");
    set({ version: get().version + 1 });
  },

  cancelPending: (ticket) => {
    const { sim } = get();
    if (!sim) return;
    sim.cancelPending(ticket);
    set({ version: get().version + 1 });
  },

  modifyPosition: (ticket, sl, tp) => {
    const { sim } = get();
    if (!sim) return false;
    try {
      const ok = sim.modifyPosition(ticket, sl, tp);
      if (ok) set({ version: get().version + 1, toast: { kind: "success", message: `Position #${ticket} SL/TP updated.` } });
      return ok;
    } catch (e) {
      set({ toast: { kind: "error", message: errText(e) } });
      return false;
    }
  },

  modifyPending: (ticket, patch) => {
    const { sim } = get();
    if (!sim) return false;
    try {
      const ok = sim.modifyPending(ticket, patch);
      if (ok) set({ version: get().version + 1, toast: { kind: "success", message: `Pending order #${ticket} modified.` } });
      return ok;
    } catch (e) {
      set({ toast: { kind: "error", message: errText(e) } });
      return false;
    }
  },

  setToast: (toast) => set({ toast }),

  setFibTool: (fibTool) =>
    set({
      fibTool,
      fibAnchor: null,
      ...(fibTool ? { shapeTool: null, shapeAnchor: null } : {}),
    }),
  setFibAnchor: (fibAnchor) => set({ fibAnchor }),
  addFib: (fib) => set({ fibs: [...get().fibs, fib] }),
  updateFib: (updated) => set({ fibs: get().fibs.map((f) => (f.id === updated.id ? updated : f)) }),
  removeFib: (id) => set({ fibs: get().fibs.filter((f) => f.id !== id) }),
  clearDrawings: () =>
    set({ fibs: [], fibTool: null, fibAnchor: null, shapes: [], shapeTool: null, shapeAnchor: null }),

  setShapeTool: (shapeTool) =>
    set({
      shapeTool,
      shapeAnchor: null,
      ...(shapeTool ? { fibTool: null, fibAnchor: null } : {}),
    }),
  setShapeAnchor: (shapeAnchor) => set({ shapeAnchor }),
  addShape: (shape) => set({ shapes: [...get().shapes, shape] }),
  updateShape: (updated) => set({ shapes: get().shapes.map((s) => (s.id === updated.id ? updated : s)) }),
  removeShape: (id) => set({ shapes: get().shapes.filter((s) => s.id !== id) }),

  addIndicator: (kind) => {
    const id = indicatorSeq++;
    const instance = createIndicatorInstance(kind, id);
    set({ indicators: [...get().indicators, instance], indicatorEditorId: id });
  },
  updateIndicator: (updated) =>
    set({ indicators: get().indicators.map((inst) => (inst.id === updated.id ? updated : inst)) }),
  removeIndicator: (id) =>
    set({
      indicators: get().indicators.filter((inst) => inst.id !== id),
      indicatorEditorId: get().indicatorEditorId === id ? null : get().indicatorEditorId,
    }),
  clearIndicators: () => set({ indicators: [], indicatorEditorId: null }),
  openIndicatorEditor: (indicatorEditorId) => set({ indicatorEditorId }),

  setCrosshair: (crosshair) => set({ crosshair }),
  setShowVolume: (showVolume) => set({ showVolume }),
}));
