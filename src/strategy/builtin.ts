import type { Strategy, StrategyContext } from "./api";
import { getSymbolSpec } from "../engine/symbols";

function smaAt(ctx: StrategyContext, index: number, period: number): number | undefined {
  if (index - period + 1 < 0) return undefined;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i++) {
    const b = ctx.history.at(i);
    if (!b) return undefined;
    sum += b.bid.c;
  }
  return sum / period;
}

export interface SmaCrossOptions {
  fast?: number;
  slow?: number;
  lots?: number;
  slPips?: number;
  tpPips?: number;
}

/**
 * Classic dual-SMA crossover with optional hard SL/TP.
 *
 * The cross is detected on the *previous* bar versus the current one, and
 * orders are filled at the next bar's open (see Simulator), so there is no
 * look-ahead bias anywhere in the pipeline.
 */
export class SmaCrossStrategy implements Strategy {
  name = "SMA Crossover";
  description: string;
  private readonly opts: Required<SmaCrossOptions>;

  constructor(opts: SmaCrossOptions = {}) {
    this.opts = { fast: opts.fast ?? 20, slow: opts.slow ?? 50, lots: opts.lots ?? 0.1, slPips: opts.slPips ?? 0, tpPips: opts.tpPips ?? 0 };
    this.description = `${this.opts.fast}/${this.opts.slow} SMA cross, ${this.opts.lots} lots`;
  }

  onBar(ctx: StrategyContext): void {
    const { fast, slow, lots, slPips, tpPips } = this.opts;
    if (fast >= slow) return;

    const prevFast = smaAt(ctx, ctx.index - 1, fast);
    const prevSlow = smaAt(ctx, ctx.index - 1, slow);
    const curFast = smaAt(ctx, ctx.index, fast);
    const curSlow = smaAt(ctx, ctx.index, slow);
    if (prevFast === undefined || prevSlow === undefined || curFast === undefined || curSlow === undefined) return;

    const crossUp = prevFast <= prevSlow && curFast > curSlow;
    const crossDown = prevFast >= prevSlow && curFast < curSlow;
    if (!crossUp && !crossDown) return;

    const spec = getSymbolSpec(ctx.symbol);
    const price = ctx.bar.bid.c;
    const hasLong = ctx.positions.some((p) => p.side === "buy");
    const hasShort = ctx.positions.some((p) => p.side === "sell");

    if (crossUp) {
      if (hasShort) ctx.closeAll();
      if (!hasLong) {
        ctx.buy(lots, {
          sl: slPips > 0 ? price - slPips * spec.pipSize : undefined,
          tp: tpPips > 0 ? price + tpPips * spec.pipSize : undefined,
          comment: "sma-cross",
        });
      }
    } else {
      if (hasLong) ctx.closeAll();
      if (!hasShort) {
        ctx.sell(lots, {
          sl: slPips > 0 ? price + slPips * spec.pipSize : undefined,
          tp: tpPips > 0 ? price - tpPips * spec.pipSize : undefined,
          comment: "sma-cross",
        });
      }
    }
  }
}
