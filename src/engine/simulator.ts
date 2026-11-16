import {
  computeMarginLevel,
  floatingUsd,
  grossPnlUsd,
  marginUsd,
  midOf,
  markPrice,
  pipValueUsd,
  usdRate,
  type PriceBook,
  type RateOverrides,
} from "./account";
import { getSymbolSpec } from "./symbols";
import type { Strategy, StrategyContext } from "../strategy/api";
import type {
  AccountConfig,
  AccountSnapshot,
  Bar,
  ClosedTrade,
  CloseReason,
  EquityPoint,
  PendingOrder,
  PendingType,
  Position,
  Side,
  SimEvent,
  SimEventKind,
  SymbolSpec,
} from "./types";

export const DEFAULT_ACCOUNT: AccountConfig = {
  initialBalance: 10_000,
  leverage: 100,
  currency: "USD",
  stopOutLevel: 50,
  commissionPerLot: 0,
  slippagePips: 0,
};

interface QueuedMarket {
  side: Side;
  lots: number;
  sl: number | null;
  tp: number | null;
  comment: string;
}

/** Convert overrides from a simple record so the UI can patch rates live. */
class MapOverrides implements RateOverrides {
  constructor(private readonly map: Map<string, number>) {}
  get(currency: string): number | undefined {
    return this.map.get(currency);
  }
}

export interface SimulatorConfig extends Partial<AccountConfig> {
  /** Explicit conversion rates, e.g. { GBP: 1.27, JPY: 0.00725 }. */
  conversionRates?: Record<string, number>;
}

/**
 * Bar-driven broker simulator with MT4-compatible account semantics:
 * margin/equity/stop-out, pending orders, swap, commission, slippage.
 *
 * Usage:
 *   const sim = new Simulator({ symbol, bars, config });
 *   for (let i = 0; i < bars.length; i++) sim.step(i);
 *
 * `step(i)` processes bar `i` end-to-end and appends to the equity curve.
 */
export class Simulator {
  readonly config: AccountConfig;
  readonly symbol: string;
  readonly bars: Bar[];
  readonly spec: SymbolSpec;

  balance: number;
  positions: Position[] = [];
  pendings: PendingOrder[] = [];
  closed: ClosedTrade[] = [];
  equityCurve: EquityPoint[] = [];
  events: SimEvent[] = [];
  book: PriceBook = new Map();
  strategy: Strategy | null = null;

  private readonly overrides: MapOverrides;
  private nextPositionTicket = 1;
  private nextPendingTicket = 1;
  private lastSwapDay: number | null = null;
  private queued: QueuedMarket[] = [];
  private currentIndex = -1;
  private lastBar: Bar | null = null;

  constructor(opts: { symbol: string; bars: Bar[]; config?: SimulatorConfig }) {
    this.symbol = opts.symbol.toUpperCase();
    this.bars = opts.bars;
    this.spec = getSymbolSpec(this.symbol);
    const { conversionRates, ...cfg } = opts.config ?? {};
    this.config = { ...DEFAULT_ACCOUNT, ...cfg };
    this.overrides = new MapOverrides(new Map(Object.entries(conversionRates ?? {})));
    this.balance = this.config.initialBalance;
  }

  // ---------------------------------------------------------------- state

  get equity(): number {
    let e = this.balance;
    for (const p of this.positions) e += this.floatingFor(p);
    return e;
  }

  get margin(): number {
    return this.marginOf(this.positions);
  }

  get freeMargin(): number {
    return this.equity - this.margin;
  }

  get marginLevel(): number {
    return computeMarginLevel(this.equity, this.margin);
  }

  get floating(): number {
    return this.positions.reduce((sum, p) => sum + this.floatingFor(p), 0);
  }

  snapshot(): AccountSnapshot {
    const equity = this.equity;
    const margin = this.margin;
    return {
      balance: this.balance,
      equity,
      margin,
      freeMargin: equity - margin,
      marginLevel: computeMarginLevel(equity, margin),
      floatingPnl: this.floating,
      currency: this.config.currency,
    };
  }

  pipValueUsd(): number {
    const price = this.lastBar ? this.lastBar.bid.c : 0;
    return pipValueUsd(this.spec, price, this.book, this.overrides);
  }

  currentBar(): Bar | null {
    return this.lastBar;
  }

  get processedBars(): number {
    return this.currentIndex + 1;
  }

  // ------------------------------------------------------------ replay

  /** Attach a strategy; `onStart` runs immediately with the current snapshot. */
  attachStrategy(strategy: Strategy | null): void {
    this.strategy = strategy;
    if (strategy?.onStart) strategy.onStart(this.snapshot());
  }

  reset(): void {
    this.balance = this.config.initialBalance;
    this.positions = [];
    this.pendings = [];
    this.closed = [];
    this.equityCurve = [];
    this.events = [];
    this.book = new Map();
    this.queued = [];
    this.currentIndex = -1;
    this.lastBar = null;
    this.lastSwapDay = null;
    this.nextPositionTicket = 1;
    this.nextPendingTicket = 1;
  }

  /**
   * Process bar at `index`: swap rollover, queued strategy fills, pending
   * triggers, SL/TP, stop-out, equity snapshot, then strategy `onBar`.
   */
  step(index: number): void {
    const bar = this.bars[index];
    if (!bar) return;
    this.currentIndex = index;
    this.lastBar = bar;
    this.book.set(this.symbol, midOf(bar));

    this.rolloverSwap(bar.ts);
    this.executeQueued(bar);
    this.checkPendings(bar);
    this.checkStops(bar);
    this.applyStopOut(bar);
    this.snapshotEquity(bar);

    if (this.strategy) {
      this.strategy.onBar(this.buildContext(bar));
    }
  }

  /** Replay every bar synchronously (used for "backtest to end"). */
  runToEnd(): void {
    for (let i = this.currentIndex + 1; i < this.bars.length; i++) this.step(i);
  }

  // ------------------------------------------------------------ trading

  /** Manual market order executed at the latest processed bar's close. */
  marketOrder(side: Side, lots: number, opts?: { sl?: number | null; tp?: number | null; comment?: string }): Position | null {
    const bar = this.lastBar;
    if (!bar) return null;
    const fill = side === "buy" ? bar.ask.c : bar.bid.c;
    return this.openPosition(side, lots, fill, bar.ts, opts?.sl ?? null, opts?.tp ?? null, opts?.comment ?? "manual");
  }

  placePending(
    type: PendingType,
    lots: number,
    price: number,
    opts?: { sl?: number | null; tp?: number | null; comment?: string; expiresAt?: number | null },
  ): PendingOrder | null {
    const bar = this.lastBar;
    if (!bar) this.fail("Place a pending order after the replay has started");
    const err = this.validatePending(type, price, bar);
    if (err) {
      this.fail(err);
      return null;
    }
    const order: PendingOrder = {
      ticket: this.nextPendingTicket++,
      symbol: this.symbol,
      type,
      lots,
      price,
      sl: opts?.sl ?? null,
      tp: opts?.tp ?? null,
      comment: opts?.comment ?? "pending",
      createdAt: bar.ts,
      expiresAt: opts?.expiresAt ?? null,
    };
    this.pendings.push(order);
    this.pushEvent("info", bar.ts, `Pending ${type} ${lots.toFixed(2)} @ ${price} placed (#${order.ticket})`);
    return order;
  }

  cancelPending(ticket: number): boolean {
    const idx = this.pendings.findIndex((p) => p.ticket === ticket);
    if (idx === -1) return false;
    const [o] = this.pendings.splice(idx, 1);
    this.pushEvent("pending_cancel", this.lastBar?.ts ?? 0, `Pending #${o.ticket} cancelled`);
    return true;
  }

  /**
   * Modify a pending order's trigger price and/or SL/TP.
   * `null` removes SL/TP; `undefined` leaves the field untouched.
   * Throws on invalid combinations (same rules as placing the order).
   */
  modifyPending(
    ticket: number,
    patch: { price?: number | null; sl?: number | null; tp?: number | null },
  ): boolean {
    const order = this.pendings.find((o) => o.ticket === ticket);
    if (!order) return false;
    const bar = this.lastBar;
    if (!bar) return false;

    const nextPrice = patch.price ?? order.price;
    if (patch.price !== undefined) {
      if (patch.price == null) this.fail("A pending order needs a trigger price");
      const err = this.validatePending(order.type, nextPrice, bar);
      if (err) this.fail(err);
    }
    const isBuySide = order.type === "buy_limit" || order.type === "buy_stop";
    const nextSl = patch.sl !== undefined ? patch.sl : order.sl;
    const nextTp = patch.tp !== undefined ? patch.tp : order.tp;
    if (nextSl != null) {
      const bad = isBuySide ? nextSl >= nextPrice : nextSl <= nextPrice;
      if (bad) {
        this.fail(`Invalid SL for ${order.type.replace("_", " ")}: must be ${isBuySide ? "below" : "above"} the trigger price`);
      }
    }
    if (nextTp != null) {
      const bad = isBuySide ? nextTp <= nextPrice : nextTp >= nextPrice;
      if (bad) {
        this.fail(`Invalid TP for ${order.type.replace("_", " ")}: must be ${isBuySide ? "above" : "below"} the trigger price`);
      }
    }
    order.price = nextPrice;
    order.sl = nextSl;
    order.tp = nextTp;
    this.pushEvent("info", bar.ts, `Pending #${order.ticket} modified (price ${nextPrice})`);
    return true;
  }

  closePosition(ticket: number, reason: CloseReason = "manual"): ClosedTrade | null {
    const idx = this.positions.findIndex((p) => p.ticket === ticket);
    if (idx === -1) return null;
    const bar = this.lastBar;
    if (!bar) return null;
    return this.closeAt(idx, markPrice(this.positions[idx].side, bar.bid.c, bar.ask.c), bar.ts, reason);
  }

  closeAllPositions(reason: CloseReason = "manual"): void {
    for (const p of [...this.positions]) this.closePosition(p.ticket, reason);
  }

  modifyPosition(ticket: number, sl: number | null, tp: number | null): boolean {
    const pos = this.positions.find((p) => p.ticket === ticket);
    if (!pos) return false;
    if (sl != null) {
      const bad = pos.side === "buy" ? sl >= pos.openPrice : sl <= pos.openPrice;
      if (bad) {
        this.fail(`Stop loss for a ${pos.side} must be ${pos.side === "buy" ? "below" : "above"} entry`);
        return false;
      }
    }
    if (tp != null) {
      const bad = pos.side === "buy" ? tp <= pos.openPrice : tp >= pos.openPrice;
      if (bad) {
        this.fail(`Take profit for a ${pos.side} must be ${pos.side === "buy" ? "above" : "below"} entry`);
        return false;
      }
    }
    pos.sl = sl;
    pos.tp = tp;
    return true;
  }

  // ------------------------------------------------------- internals

  private openPosition(
    side: Side,
    lots: number,
    fillPrice: number,
    ts: number,
    sl: number | null,
    tp: number | null,
    comment: string,
  ): Position | null {
    const bar = this.lastBar;
    if (!bar) return null;
    lots = Math.round(lots * 100) / 100;
    if (!(lots >= 0.01) || lots > 1000) {
      this.fail("Lot size must be between 0.01 and 1000");
      return null;
    }
    if (sl != null) {
      const bad = side === "buy" ? sl >= fillPrice : sl <= fillPrice;
      if (bad) {
        this.fail(`Invalid SL for ${side}: must be ${side === "buy" ? "below" : "above"} the entry price`);
        return null;
      }
    }
    if (tp != null) {
      const bad = side === "buy" ? tp <= fillPrice : tp >= fillPrice;
      if (bad) {
        this.fail(`Invalid TP for ${side}: must be ${side === "buy" ? "above" : "below"} the entry price`);
        return null;
      }
    }
    const mid = (bar.bid.c + bar.ask.c) / 2;
    const newMargin = marginUsd(this.spec, lots, mid, this.config.leverage, this.book, this.overrides);
    const { equity } = this.snapshot();
    if (equity - this.margin - newMargin < 0) {
      this.fail("Not enough free margin to open this position");
      return null;
    }
    const commission = -Math.abs(this.config.commissionPerLot) * lots;
    this.balance += commission; // commission charged immediately, like MT4
    const pos: Position = {
      ticket: this.nextPositionTicket++,
      symbol: this.symbol,
      side,
      lots,
      openPrice: fillPrice,
      openTime: ts,
      sl,
      tp,
      comment,
      swap: 0,
      commission,
    };
    this.positions.push(pos);
    this.pushEvent("open", ts, `${side.toUpperCase()} ${lots.toFixed(2)} ${this.symbol} @ ${fillPrice.toFixed(this.spec.digits)} (#${pos.ticket})`);
    return pos;
  }

  private closeAt(index: number, exitPrice: number, ts: number, reason: CloseReason): ClosedTrade {
    const pos = this.positions[index];
    const closeCommission = -Math.abs(this.config.commissionPerLot) * pos.lots;
    const gross = grossPnlUsd(pos.side, this.spec, pos.lots, pos.openPrice, exitPrice, this.book, this.overrides);
    const net = gross + pos.swap + pos.commission + closeCommission;
    this.balance += gross + pos.swap + closeCommission;

    const trade: ClosedTrade = {
      ticket: pos.ticket,
      symbol: pos.symbol,
      side: pos.side,
      lots: pos.lots,
      openPrice: pos.openPrice,
      openTime: pos.openTime,
      closePrice: exitPrice,
      closeTime: ts,
      pnl: net,
      swap: pos.swap,
      commission: pos.commission + closeCommission,
      reason,
      comment: pos.comment,
    };
    this.positions.splice(index, 1);
    this.closed.push(trade);
    this.pushEvent(
      "close",
      ts,
      `Close #${pos.ticket} @ ${exitPrice.toFixed(this.spec.digits)} → ${net >= 0 ? "+" : ""}${net.toFixed(2)} (${reason})`,
    );
    return trade;
  }

  private executeQueued(bar: Bar): void {
    const queue = this.queued;
    this.queued = [];
    for (const q of queue) {
      const fillBase = q.side === "buy" ? bar.ask.o : bar.bid.o;
      const slip = this.config.slippagePips * this.spec.pipSize;
      const fill = q.side === "buy" ? fillBase + slip : fillBase - slip;
      this.openFromStrategy(q.side, q.lots, fill, bar.ts, q.sl, q.tp, q.comment);
    }
  }

  private openFromStrategy(side: Side, lots: number, fill: number, ts: number, sl: number | null, tp: number | null, comment: string): void {
    const pos = this.openPosition(side, lots, fill, ts, sl, tp, comment);
    if (!pos) this.pushEvent("strategy", ts, `Order rejected at ${fill.toFixed(this.spec.digits)} (${side} ${lots})`);
  }

  private checkPendings(bar: Bar): void {
    const { bid, ask } = bar;
    for (const order of [...this.pendings]) {
      if (order.expiresAt != null && bar.ts >= order.expiresAt) {
        this.pendings = this.pendings.filter((o) => o.ticket !== order.ticket);
        this.pushEvent("pending_cancel", bar.ts, `Pending #${order.ticket} expired`);
        continue;
      }
      let fill: number | null = null;
      switch (order.type) {
        case "buy_limit":
          if (ask.l <= order.price) fill = Math.min(order.price, ask.o);
          break;
        case "sell_limit":
          if (bid.h >= order.price) fill = Math.max(order.price, bid.o);
          break;
        case "buy_stop":
          if (ask.h >= order.price) fill = Math.max(order.price, ask.o);
          break;
        case "sell_stop":
          if (bid.l <= order.price) fill = Math.min(order.price, bid.o);
          break;
      }
      if (fill == null) continue;
      this.pendings = this.pendings.filter((o) => o.ticket !== order.ticket);
      const side: Side = order.type === "buy_limit" || order.type === "buy_stop" ? "buy" : "sell";
      const pos = this.openPosition(side, order.lots, fill, bar.ts, order.sl, order.tp, order.comment);
      if (!pos) {
        this.pushEvent("strategy", bar.ts, `Pending #${order.ticket} triggered but could not open (margin)`);
        continue;
      }
      this.pushEvent("pending_fill", bar.ts, `Pending #${order.ticket} filled @ ${fill.toFixed(this.spec.digits)}`);
    }
  }

  private checkStops(bar: Bar): void {
    for (const pos of [...this.positions]) {
      const exit = this.stopHit(pos, bar);
      if (!exit) continue;
      const idx = this.positions.indexOf(pos);
      if (idx === -1) continue;
      this.closeAt(idx, exit.price, bar.ts, exit.reason);
    }
  }

  private stopHit(pos: Position, bar: Bar): { price: number; reason: "sl" | "tp" } | null {
    if (pos.side === "buy") {
      const { bid } = bar;
      // Conservative: if both SL and TP are inside the bar, SL wins.
      if (pos.sl != null && bid.l <= pos.sl) {
        return { price: bid.o <= pos.sl ? bid.o : pos.sl, reason: "sl" };
      }
      if (pos.tp != null && bid.h >= pos.tp) {
        return { price: bid.o >= pos.tp ? bid.o : pos.tp, reason: "tp" };
      }
      return null;
    }
    const { ask } = bar;
    if (pos.sl != null && ask.h >= pos.sl) {
      return { price: ask.o >= pos.sl ? ask.o : pos.sl, reason: "sl" };
    }
    if (pos.tp != null && ask.l <= pos.tp) {
      return { price: ask.o <= pos.tp ? ask.o : pos.tp, reason: "tp" };
    }
    return null;
  }

  private applyStopOut(bar: Bar): void {
    while (this.positions.length > 0) {
      const equity = this.equity;
      const margin = this.margin;
      if (margin === 0) return;
      const level = computeMarginLevel(equity, margin);
      if (level >= this.config.stopOutLevel) return;
      // Close the worst position first, like MT4.
      const losses = this.positions.map((p) => ({ p, f: this.floatingFor(p) }));
      losses.sort((a, b) => a.f - b.f);
      const worst = losses[0].p;
      const exit = markPrice(worst.side, bar.bid.c, bar.ask.c);
      const idx = this.positions.indexOf(worst);
      const trade = this.closeAt(idx, exit, bar.ts, "stopout");
      this.pushEvent("stopout", bar.ts, `Margin call: position #${trade.ticket} closed (level ${level.toFixed(1)}%)`);
    }
  }

  private rolloverSwap(ts: number): void {
    const day = Math.floor(ts / 86_400);
    if (this.lastSwapDay == null) {
      this.lastSwapDay = day;
      return;
    }
    if (day <= this.lastSwapDay) return;
    const from = this.lastSwapDay;
    const to = day - 1;
    this.lastSwapDay = day;
    if (this.positions.length === 0) return;
    let total = 0;
    for (let d = from; d <= to; d++) {
      const weekday = new Date(d * 86_400_000).getUTCDay();
      const multiplier = weekday === this.spec.tripleSwapWeekday ? 3 : 1;
      for (const pos of this.positions) {
        const perLot = pos.side === "buy" ? this.spec.swapLong : this.spec.swapShort;
        const amount = perLot * pos.lots * multiplier;
        pos.swap += amount;
        total += amount;
      }
    }
    if (total !== 0) {
      this.pushEvent("swap", ts, `Swap charged: ${total >= 0 ? "+" : ""}${total.toFixed(2)} ${this.config.currency}`);
    }
  }

  private snapshotEquity(bar: Bar): void {
    const equity = this.equity;
    const margin = this.margin;
    this.equityCurve.push({ ts: bar.ts, balance: this.balance, equity, margin });
  }

  private marginOf(positions: Position[]): number {
    const bar = this.lastBar;
    if (!bar) return 0;
    const mid = (bar.bid.c + bar.ask.c) / 2;
    let m = 0;
    for (const p of positions) {
      m += marginUsd(this.spec, p.lots, mid, this.config.leverage, this.book, this.overrides);
    }
    return m;
  }

  private floatingFor(pos: Position): number {
    const bar = this.lastBar;
    if (!bar) return 0;
    return floatingUsd(pos, this.spec, bar.bid.c, bar.ask.c, this.book, this.overrides) + pos.swap;
  }

  private validatePending(type: PendingType, price: number, bar: Bar): string | null {
    const { bid, ask } = bar;
    switch (type) {
      case "buy_limit":
        return price < ask.c ? null : "Buy limit must be below the current ask";
      case "sell_limit":
        return price > bid.c ? null : "Sell limit must be above the current bid";
      case "buy_stop":
        return price > ask.c ? null : "Buy stop must be above the current ask";
      case "sell_stop":
        return price < bid.c ? null : "Sell stop must be below the current bid";
    }
  }

  private fail(message: string): never {
    throw new Error(message);
  }

  private pushEvent(kind: SimEventKind, ts: number, message: string): void {
    this.events.push({ ts, kind, message });
  }

  private buildContext(bar: Bar): StrategyContext {
    const sim = this;
    const ts = bar.ts;
    const history = {
      lookback: (n: number): Bar | undefined => this.bars[this.currentIndex - n],
      at: (index: number): Bar | undefined => this.bars[index],
      sma: (period: number): number | undefined => {
        if (period <= 0 || this.currentIndex + 1 < period) return undefined;
        let sum = 0;
        for (let i = this.currentIndex - period + 1; i <= this.currentIndex; i++) sum += this.bars[i].bid.c;
        return sum / period;
      },
      volumeSma: (period: number): number | undefined => {
        if (period <= 0 || this.currentIndex + 1 < period) return undefined;
        let sum = 0;
        for (let i = this.currentIndex - period + 1; i <= this.currentIndex; i++) sum += this.bars[i].volume;
        return sum / period;
      },
    };
    return {
      symbol: this.symbol,
      bar,
      index: this.currentIndex,
      account: this.snapshot(),
      positions: this.positions.filter((p) => p.symbol === this.symbol),
      history,
      buy: (lots, opts) => {
        sim.queued.push({ side: "buy", lots, sl: opts?.sl ?? null, tp: opts?.tp ?? null, comment: opts?.comment ?? "strategy" });
      },
      sell: (lots, opts) => {
        sim.queued.push({ side: "sell", lots, sl: opts?.sl ?? null, tp: opts?.tp ?? null, comment: opts?.comment ?? "strategy" });
      },
      pending: (type, lots, price, opts) => {
        try {
          sim.placePending(type, lots, price, opts);
        } catch {
          sim.pushEvent("strategy", ts, `Pending ${type} rejected (price ${price})`);
        }
      },
      close: (ticket) => {
        sim.closePosition(ticket, "strategy");
      },
      closeAll: () => {
        sim.closeAllPositions("strategy");
      },
      log: (message: string) => {
        sim.pushEvent("strategy", ts, message);
      },
    };
  }
}

/** Convenience wrapper used by the store and tests. */
export function runBacktest(symbol: string, bars: Bar[], config?: SimulatorConfig, strategy?: Strategy | null): Simulator {
  const sim = new Simulator({ symbol, bars, config });
  if (strategy) sim.attachStrategy(strategy);
  sim.runToEnd();
  return sim;
}

export { usdRate };
