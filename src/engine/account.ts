import type { OHLC, Position, Side, SymbolSpec } from "./types";

/** Latest mid price per symbol code, used for currency conversion. */
export type PriceBook = Map<string, number>;

/** Conversion rates the simulator can use when the needed pair is not loaded. */
export interface RateOverrides {
  get(currency: string): number | undefined;
}

export function midOf(bar: { bid: OHLC; ask: OHLC }): number {
  return (bar.bid.c + bar.ask.c) / 2;
}

/**
 * Value of 1 unit of `currency` in account currency (USD).
 * Resolution order: explicit override -> `${ccy}USD` -> `USD${ccy}` inverse -> 1.
 */
export function usdRate(currency: string, book: PriceBook, overrides?: RateOverrides): number {
  if (currency === "USD") return 1;
  const o = overrides?.get(currency);
  if (o) return o;
  const direct = book.get(currency + "USD");
  if (direct) return direct;
  const inverse = book.get("USD" + currency);
  if (inverse) return 1 / inverse;
  return 1;
}

/** Margin required for `lots` of `spec` at `price`, expressed in USD. */
export function marginUsd(
  spec: SymbolSpec,
  lots: number,
  price: number,
  leverage: number,
  book: PriceBook,
  overrides?: RateOverrides,
): number {
  const notionalQuote = lots * spec.contractSize * price; // in quote currency
  const notionalUsd = notionalQuote * usdRate(spec.quote, book, overrides);
  return notionalUsd / leverage;
}

/** Value of one pip for 1.00 lot, in USD. */
export function pipValueUsd(spec: SymbolSpec, price: number, book: PriceBook, overrides?: RateOverrides): number {
  // Pip P/L accrues in the quote currency, so convert (price argument kept for JPY pairs).
  void price;
  return spec.contractSize * spec.pipSize * usdRate(spec.quote, book, overrides);
}

/** Gross P/L (no swap/commission) of closing `lots` at `exitPrice`, in USD. */
export function grossPnlUsd(
  side: Side,
  spec: SymbolSpec,
  lots: number,
  openPrice: number,
  exitPrice: number,
  book: PriceBook,
  overrides?: RateOverrides,
): number {
  const direction = side === "buy" ? 1 : -1;
  const pnlQuote = direction * lots * spec.contractSize * (exitPrice - openPrice);
  return pnlQuote * usdRate(spec.quote, book, overrides);
}

/** Mark-to-market price for a position: buys see bid, sells see ask. */
export function markPrice(side: Side, bid: number, ask: number): number {
  return side === "buy" ? bid : ask;
}

/** Unrealised P/L of a single position at current bid/ask, in USD. */
export function floatingUsd(
  pos: Pick<Position, "side" | "lots" | "openPrice">,
  spec: SymbolSpec,
  bid: number,
  ask: number,
  book: PriceBook,
  overrides?: RateOverrides,
): number {
  return grossPnlUsd(pos.side, spec, pos.lots, pos.openPrice, markPrice(pos.side, bid, ask), book, overrides);
}

export function computeMarginLevel(equity: number, margin: number): number {
  return margin > 0 ? (equity / margin) * 100 : Number.POSITIVE_INFINITY;
}
