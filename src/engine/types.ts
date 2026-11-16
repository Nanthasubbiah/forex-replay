/**
 * Core domain types for the simulator.
 *
 * The data model mirrors MT4 semantics closely enough that statements and
 * statistics produced here map 1:1 onto what traders expect from MetaTrader.
 */

export interface OHLC {
  o: number;
  h: number;
  l: number;
  c: number;
}

/** A single candle with separate bid and ask prices (as provided by evtradelabs). */
export interface Bar {
  /** Unix timestamp in seconds (UTC). */
  ts: number;
  bid: OHLC;
  ask: OHLC;
  volume: number;
}

export type Side = "buy" | "sell";

export type PendingType = "buy_limit" | "sell_limit" | "buy_stop" | "sell_stop";

export type OrderKind = "market" | PendingType;

export type CloseReason = "manual" | "sl" | "tp" | "stopout" | "strategy";

export interface SymbolSpec {
  code: string;
  description: string;
  base: string;
  quote: string;
  /** Units of base currency per 1.00 lot (MT4: 100000 for FX). */
  contractSize: number;
  /** Number of decimals used for display. */
  digits: number;
  /** Price distance of one pip (0.0001 for EURUSD, 0.01 for USDJPY). */
  pipSize: number;
  /** Swap charged per 1.00 lot per night for a long position, in account currency. */
  swapLong: number;
  /** Swap charged per 1.00 lot per night for a short position, in account currency. */
  swapShort: number;
  /** UTC weekday (0=Sun..6=Sat) that receives a triple swap. */
  tripleSwapWeekday: number;
}

export interface AccountConfig {
  initialBalance: number;
  leverage: number;
  currency: string;
  /** Positions are force-closed when margin level falls below this percentage. */
  stopOutLevel: number;
  /** Commission in account currency per lot per side. */
  commissionPerLot: number;
  /** Assumed slippage in pips applied to market order execution. */
  slippagePips: number;
}

export interface Position {
  ticket: number;
  symbol: string;
  side: Side;
  lots: number;
  openPrice: number;
  openTime: number;
  sl: number | null;
  tp: number | null;
  comment: string;
  /** Accrued swap in account currency (applied to balance at close). */
  swap: number;
  /** Opening commission in account currency (already deducted from balance). */
  commission: number;
}

export interface ClosedTrade {
  ticket: number;
  symbol: string;
  side: Side;
  lots: number;
  openPrice: number;
  openTime: number;
  closePrice: number;
  closeTime: number;
  /** Net profit including swap and both commission sides. */
  pnl: number;
  swap: number;
  commission: number;
  reason: CloseReason;
  comment: string;
}

export interface PendingOrder {
  ticket: number;
  symbol: string;
  type: PendingType;
  lots: number;
  price: number;
  sl: number | null;
  tp: number | null;
  comment: string;
  ocoGroup: number | null;
  createdAt: number;
  expiresAt: number | null;
}

export interface EquityPoint {
  ts: number;
  balance: number;
  equity: number;
  margin: number;
}

export type SimEventKind =
  | "open"
  | "close"
  | "pending_fill"
  | "pending_cancel"
  | "stopout"
  | "swap"
  | "strategy"
  | "info";

export interface SimEvent {
  ts: number;
  kind: SimEventKind;
  message: string;
}

export interface AccountSnapshot {
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  floatingPnl: number;
  currency: string;
}
