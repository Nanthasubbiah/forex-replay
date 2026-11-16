import { create } from "zustand";
import { Simulator } from "./engine/simulator";
import type { SimulatorConfig } from "./engine/simulator";
import type { Bar, PendingType, Side } from "./engine/types";
import { generateDemoBars } from "./data/demo";
import { parseDataFile } from "./data/parse";
import { SmaCrossStrategy } from "./strategy/builtin";
import { getSymbolSpec } from "./engine/symbols";

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
  /** Number of bars already processed by the simulato. */
  pos: number;
  running: boolean;
  speed: number;
  sim: Simulator | null;
  settings: AccountSettings;
  version: number;
  strategyKind: StrategyKind | null;
  toast: Toast | null;

  loadDemo: () => void;
  loadFile: (file: File) => Promise<void>;
  loadBars: (symbol: string, bars: Bar[], sourceName: string) => void;
  reset: () => void;
  step: () => void;
  play: () => void;
  pause: () => void;
  setSpeed: (n: number) => void;
  backtestToEnd: () => void;
  setStrategy: (kind: StrategyKind | null) => void;
  updateSettings: (patch: Partial<AccountSettings>) => void;

  buyMarket: (side: Side, lots: number, slPips: number, tpPips: number) => void;
  placePending: (type: PendingType, lots: number, price: number, slPips: number, tpPips: number, oco: boolean) => void;
  closeTicket: (ticket: number) => void;
  closeAll: () => void;
  cancelPending: (ticket: number) => void;
  modifyPosition: (ticket: number, sl: number | null, tp: number | null) => boolean;
  modifyPending: (ticket: number, patch: { price?: number | null; sl?: number | null; tp?: number | null }) => boolean;
  setToast: (toast: Toast | null) => void;
}

let timer: ReturnType<typeof setInterval> | null = null;
let ocoSeq = 1;

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
  pos: 0,
  running: false,
  speed: 10,
  sim: null,
  settings: DEFAULT_SETTINGS,
  version: 0,
  strategyKind: null,
  toast: null,

  loadDemo: () => {
    const bars = generateDemoBars({ symbol: "EURUSD", count: 6000, tfMinutes: 5 });
    get().loadBars("EURUSD", bars, "Demo — EURUSD M5, synthetic");
    set({ toast: { kind: "success", message: "Demo EURUSD M5 loaded — press Play or Backtest." } });
  },

  loadFile: async (file) => {
    try {
      const parsed = await parseDataFile(file, {
        assumeSpreadPips: get().settings.assumeSpreadPips,
        defaultSymbol: "EURUSD",
      });
      const symbol = parsed.symbol ?? "EURUSD";
      get().loadBars(symbol, parsed.bars, `${file.name} — ${parsed.bars.length.toLocaleString()} bars`);
      const warnings = parsed.warnings.length > 0 ? ` ${parsed.warnings.join(" ")}` : "";
      set({ toast: { kind: "success", message: `Loaded ${symbol} (${parsed.bars.length.toLocaleString()} bars).${warnings}` } });
    } catch (e) {
      set({ toast: { kind: "error", message: `${file.name}: ${errText(e)}` } });
    }
  },

  loadBars: (symbol, bars, sourceName) => {
    stopTimer();
    const sim = new Simulator({ symbol, bars, config: simConfig(get().settings) });
    set({
      loaded: { symbol, bars, sourceName },
      sim,
      pos: 0,
      running: false,
      strategyKind: null,
      version: get().version + 1,
      toast: null,
    });
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

  buyMarket: (side, lots, slPips, tpPips) => {
    const { sim, loaded } = get();
    if (!sim || !loaded) return;
    const bar = sim.currentBar();
    if (!bar) {
      set({ toast: { kind: "warning", message: "Press Play or Step to start the replay first — market orders need a live price." } });
      return;
    }
    try {
      const spec = getSymbolSpec(loaded.symbol);
      const fill = side === "buy" ? bar.ask.c : bar.bid.c;
      const sl = slPips > 0 ? (side === "buy" ? fill - slPips * spec.pipSize : fill + slPips * spec.pipSize) : null;
      const tp = tpPips > 0 ? (side === "buy" ? fill + tpPips * spec.pipSize : fill - tpPips * spec.pipSize) : null;
      sim.marketOrder(side, lots, { sl, tp, comment: "manual" });
      set({ version: get().version + 1, toast: null });
    } catch (e) {
      set({ toast: { kind: "error", message: errText(e) } });
    }
  },

  placePending: (type, lots, price, slPips, tpPips, oco) => {
    const { sim, loaded } = get();
    if (!sim || !loaded) return;
    if (!sim.currentBar()) {
      set({ toast: { kind: "warning", message: "Start the replay before placing pending orders." } });
      return;
    }
    try {
      const spec = getSymbolSpec(loaded.symbol);
      const isBuy = type === "buy_limit" || type === "buy_stop";
      const sl = slPips > 0 ? (isBuy ? price - slPips * spec.pipSize : price + slPips * spec.pipSize) : null;
      const tp = tpPips > 0 ? (isBuy ? price + tpPips * spec.pipSize : price - tpPips * spec.pipSize) : null;
      sim.placePending(type, lots, price, { sl, tp, ocoGroup: oco ? ocoSeq++ : null });
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
}));
