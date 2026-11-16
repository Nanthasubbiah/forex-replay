import { describe, expect, it } from "vitest";
import { Simulator, type SimulatorConfig } from "../src/engine/simulator";
import { bar, flatBar, T0 } from "./helpers";

function makeSim(bars: ReturnType<typeof bar>[], config?: SimulatorConfig): Simulator {
  return new Simulator({ symbol: "EURUSD", bars, config });
}

describe("market orders", () => {
  it("buys at ask close with commission and margin applied", () => {
    const bars = [flatBar(T0, 1.1)];
    const sim = makeSim(bars, { initialBalance: 10_000, commissionPerLot: 0 });
    sim.step(0);
    const pos = sim.marketOrder("buy", 1);
    expect(pos).not.toBeNull();
    expect(pos!.openPrice).toBeCloseTo(1.1002);
    expect(sim.positions).toHaveLength(1);
    expect(sim.margin).toBeCloseTo((100_000 * 1.1001) / 100);
    expect(sim.freeMargin).toBeCloseTo(sim.equity - sim.margin);
  });

  it("rejects orders that exceed free margin", () => {
    const bars = [flatBar(T0, 1.1)];
    const sim = makeSim(bars, { initialBalance: 100, leverage: 100 });
    sim.step(0);
    expect(() => sim.marketOrder("buy", 1)).toThrow(/free margin/i);
    expect(sim.positions).toHaveLength(0);
  });

  it("moves balance by pip value when a trade closes in profit", () => {
    const bars = [
      bar(T0, 1.1, 1.1004, 1.0996, 1.1),
      bar(T0 + 300, 1.1008, 1.1012, 1.1006, 1.101),
    ];
    const sim = makeSim(bars, { initialBalance: 10_000 });
    sim.step(0);
    sim.marketOrder("buy", 1); // entry at ask close 1.1002
    sim.step(1);
    sim.closePosition(1); // exit at bid close 1.1010
    expect(sim.closed[0].pnl).toBeCloseTo((1.101 - 1.1002) * 100_000);
    expect(sim.balance).toBeCloseTo(10_080);
    expect(sim.equity).toBeCloseTo(10_080);
  });

  it("charges commission on both sides", () => {
    const bars = [flatBar(T0, 1.1), flatBar(T0 + 300, 1.1)];
    const sim = makeSim(bars, { initialBalance: 10_000, commissionPerLot: 7 });
    sim.step(0);
    sim.marketOrder("buy", 1);
    expect(sim.balance).toBeCloseTo(10_000 - 7);
    sim.step(1);
    sim.closePosition(1);
    const t = sim.closed[0];
    expect(t.commission).toBeCloseTo(-14);
    expect(t.pnl).toBeCloseTo(-34); // spread cost -20 from bid/ask plus -14 commission
  });
});

describe("stop loss / take profit", () => {
  it("closes a long at the SL when the bid trades through it", () => {
    const bars = [
      bar(T0, 1.1, 1.1004, 1.0996, 1.1),
      bar(T0 + 300, 1.0995, 1.0998, 1.0985, 1.0988),
    ];
    const sim = makeSim(bars, { initialBalance: 10_000 });
    sim.step(0);
    sim.marketOrder("buy", 1, { sl: 1.099 });
    sim.step(1);
    expect(sim.closed).toHaveLength(1);
    expect(sim.closed[0].reason).toBe("sl");
    expect(sim.closed[0].closePrice).toBeCloseTo(1.099);
    expect(sim.closed[0].pnl).toBeCloseTo((1.099 - 1.1002) * 100_000);
  });

  it("closes a long at the TP when the bid touches it", () => {
    const bars = [
      bar(T0, 1.1, 1.1004, 1.0996, 1.1),
      bar(T0 + 300, 1.1005, 1.1009, 1.1001, 1.1007),
    ];
    const sim = makeSim(bars, { initialBalance: 10_000 });
    sim.step(0);
    sim.marketOrder("buy", 1, { tp: 1.1008 });
    sim.step(1);
    expect(sim.closed[0].reason).toBe("tp");
    expect(sim.closed[0].closePrice).toBeCloseTo(1.1008);
  });

  it("gaps past the SL and fills at the open (worse than the SL)", () => {
    const bars = [
      bar(T0, 1.1, 1.1004, 1.0996, 1.1),
      bar(T0 + 300, 1.09, 1.0905, 1.089, 1.0895),
    ];
    const sim = makeSim(bars, { initialBalance: 10_000 });
    sim.step(0);
    sim.marketOrder("buy", 1, { sl: 1.0995 });
    sim.step(1);
    expect(sim.closed[0].closePrice).toBeCloseTo(1.09);
  });
});

describe("pending orders", () => {
  it("fills a buy limit at the order price", () => {
    const bars = [
      flatBar(T0, 1.1),
      bar(T0 + 300, 1.0947, 1.0952, 1.094, 1.0945),
    ];
    const sim = makeSim(bars, { initialBalance: 10_000 });
    sim.step(0);
    sim.placePending("buy_limit", 0.5, 1.095);
    sim.step(1);
    expect(sim.positions).toHaveLength(1);
    expect(sim.positions[0].openPrice).toBeCloseTo(1.0949);
    expect(sim.pendings).toHaveLength(0);
  });

  it("fills a sell stop when the bid breaches it", () => {
    const bars = [
      flatBar(T0, 1.1),
      bar(T0 + 300, 1.0995, 1.0996, 1.0985, 1.0988),
    ];
    const sim = makeSim(bars, { initialBalance: 10_000 });
    sim.step(0);
    sim.placePending("sell_stop", 0.5, 1.099);
    sim.step(1);
    expect(sim.positions).toHaveLength(1);
    expect(sim.positions[0].side).toBe("sell");
  });

  it("rejects a buy limit above the current ask", () => {
    const sim = makeSim([flatBar(T0)], { initialBalance: 10_000 });
    sim.step(0);
    expect(() => sim.placePending("buy_limit", 0.1, 1.2)).toThrow(/below the current ask/i);
  });

  it("expires pending orders", () => {
    const bars = [flatBar(T0, 1.1), flatBar(T0 + 300, 1.1)];
    const sim = makeSim(bars, { initialBalance: 10_000 });
    sim.step(0);
    sim.placePending("buy_limit", 0.1, 1.095, { expiresAt: T0 + 300 });
    sim.step(1);
    expect(sim.pendings).toHaveLength(0);
    expect(sim.events.some((e) => e.message.includes("expired"))).toBe(true);
  });
});

describe("stop out", () => {
  it("closes losing positions when margin level goes below 50%", () => {
    const bars = [
      flatBar(T0, 1.1),
      bar(T0 + 300, 1.09, 1.0905, 1.07, 1.075),
    ];
    const sim = makeSim(bars, { initialBalance: 1_000, leverage: 100 });
    sim.step(0);
    sim.marketOrder("buy", 0.9);
    expect(sim.positions).toHaveLength(1);
    sim.step(1);
    expect(sim.positions).toHaveLength(0);
    expect(sim.closed[0].reason).toBe("stopout");
    expect(sim.marginLevel).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("swap", () => {
  it("accrues daily swap and applies triple swap on Wednesday", () => {
    const bars = [flatBar(T0, 1.1), flatBar(T0 + 86_400, 1.1)]; // Mon -> Tue
    const sim = makeSim(bars, { initialBalance: 10_000 });
    sim.step(0);
    sim.marketOrder("buy", 1);
    sim.step(1);
    expect(sim.positions[0].swap).toBeCloseTo(-2.1);

    const wed = [flatBar(T0 + 172_800, 1.1), flatBar(T0 + 172_800 + 86_400, 1.1)]; // Wed -> Thu
    const sim2 = makeSim(wed, { initialBalance: 10_000 });
    sim2.step(0);
    sim2.marketOrder("buy", 1);
    sim2.step(1);
    expect(sim2.positions[0].swap).toBeCloseTo(-6.3);
  });
});

describe("strategy execution", () => {
  it("fills strategy market orders at the next bar's open", () => {
    const bars = [flatBar(T0, 1.1), flatBar(T0 + 300, 1.105)];
    const sim = makeSim(bars, { initialBalance: 10_000 });
    sim.attachStrategy({
      name: "test",
      description: "buy once",
      onBar(ctx) {
        if (ctx.index === 0) ctx.buy(1);
      },
    });
    sim.step(0);
    expect(sim.positions).toHaveLength(0); // queued, not filled
    sim.step(1);
    expect(sim.positions).toHaveLength(1);
    expect(sim.positions[0].openPrice).toBeCloseTo(1.1052); // ask open of bar 1
  });

  it("runBacktest drives the simplex to completion", () => {
    const bars = [flatBar(T0, 1.1), flatBar(T0 + 300, 1.105), flatBar(T0 + 600, 1.11)];
    const sim = makeSim(bars, { initialBalance: 10_000 });
    sim.runToEnd();
    expect(sim.processedBars).toBe(3);
    expect(sim.equityCurve).toHaveLength(3);
  });
});

describe("modify pending orders", () => {
  it("updates trigger price, SL and TP", () => {
    const sim = makeSim([flatBar(T0, 1.1)], { initialBalance: 10_000 });
    sim.step(0);
    const order = sim.placePending("buy_stop", 0.1, 1.105);
    expect(order).not.toBeNull();
    expect(sim.modifyPending(order!.ticket, { price: 1.11, sl: 1.108, tp: 1.115 })).toBe(true);
    const updated = sim.pendings[0];
    expect(updated.price).toBeCloseTo(1.11);
    expect(updated.sl).toBeCloseTo(1.108);
    expect(updated.tp).toBeCloseTo(1.115);
    expect(sim.events.some((e) => e.message.includes("modified"))).toBe(true);
  });

  it("removes SL/TP when passed null", () => {
    const sim = makeSim([flatBar(T0, 1.1)], { initialBalance: 10_000 });
    sim.step(0);
    const order = sim.placePending("buy_limit", 0.1, 1.095, { sl: 1.09, tp: 1.1 })!;
    expect(sim.modifyPending(order.ticket, { sl: null, tp: null })).toBe(true);
    expect(sim.pendings[0].sl).toBeNull();
    expect(sim.pendings[0].tp).toBeNull();
  });

  it("rejects a trigger price on the wrong side of the market", () => {
    const sim = makeSim([flatBar(T0, 1.1)], { initialBalance: 10_000 });
    sim.step(0);
    const order = sim.placePending("buy_stop", 0.1, 1.105)!;
    expect(() => sim.modifyPending(order.ticket, { price: 1.09 })).toThrow(/above the current ask/);
    expect(sim.pendings[0].price).toBeCloseTo(1.105);
  });

  it("rejects an SL on the wrong side of the trigger", () => {
    const sim = makeSim([flatBar(T0, 1.1)], { initialBalance: 10_000 });
    sim.step(0);
    const order = sim.placePending("buy_stop", 0.1, 1.105)!;
    expect(() => sim.modifyPending(order.ticket, { sl: 1.2 })).toThrow(/Invalid SL/);
  });

  it("returns false for unknown tickets", () => {
    const sim = makeSim([flatBar(T0, 1.1)], { initialBalance: 10_000 });
    sim.step(0);
    expect(sim.modifyPending(999, { price: 1.1 })).toBe(false);
  });
});

describe("modify positions", () => {
  it("sets and updates SL/TP", () => {
    const sim = makeSim([flatBar(T0, 1.1)], { initialBalance: 10_000 });
    sim.step(0);
    sim.marketOrder("buy", 0.5);
    expect(sim.modifyPosition(1, 1.09, 1.11)).toBe(true);
    expect(sim.positions[0].sl).toBeCloseTo(1.09);
    expect(sim.positions[0].tp).toBeCloseTo(1.11);
    expect(sim.modifyPosition(1, 1.095, null)).toBe(true);
    expect(sim.positions[0].sl).toBeCloseTo(1.095);
    expect(sim.positions[0].tp).toBeNull();
  });

  it("rejects invalid SL geometry", () => {
    const sim = makeSim([flatBar(T0, 1.1)], { initialBalance: 10_000 });
    sim.step(0);
    sim.marketOrder("buy", 0.5);
    expect(() => sim.modifyPosition(1, 1.2, null)).toThrow(/below/);
  });
});
