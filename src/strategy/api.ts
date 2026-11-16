import type { AccountSnapshot, Bar, PendingType, Position, Side } from "../engine/types";

/** Options shared by all order placement calls from a strategy. */
export interface OrderOptions {
  sl?: number | null;
  tp?: number | null;
  comment?: string;
}

/** Read-only history helpers. Index 0 is the oldest loaded bar. */
export interface HistoryView {
  /** Bar `n` bars before the current one; `undefined` when out of range. */
  lookback(n: number): Bar | undefined;
  /** Bar at an absolute index; `undefined` when out of range. */
  at(index: number): Bar | undefined;
  /** Simple moving average of closes over `period` bars ending at the current bar. */
  sma(period: number): number | undefined;
  /** Simple moving average of volumes over `period` bars ending at the current bar. */
  volumeSma(period: number): number | undefined;
}

/**
 * Context handed to a strategy on every completed bar.
 *
 * IMPORTANT: `onBar` is called *after* the bar has been simulated, so market
 * orders placed here are filled at the NEXT bar's open price. This makes
 * look-ahead bias impossible by construction.
 */
export interface StrategyContext {
  symbol: string;
  bar: Bar;
  index: number;
  account: AccountSnapshot;
  /** Open positions for this symbol. */
  positions: Position[];
  history: HistoryView;
  buy(lots: number, opts?: OrderOptions): void;
  sell(lots: number, opts?: OrderOptions): void;
  /** Place a pending order; valid only if the price relationship is correct for the type. */
  pending(type: PendingType, lots: number, price: number, opts?: OrderOptions): void;
  close(ticket: number): void;
  /** Close all open positions on this symbol with reason "strategy". */
  closeAll(): void;
  log(message: string): void;
}

export interface Strategy {
  name: string;
  description: string;
  /** Called once when the strategy is attached, before the first bar. */
  onStart?(ctx: AccountSnapshot): void;
  /** Called after every processed bar. */
  onBar(ctx: StrategyContext): void;
}

export type { Side, PendingType };
