import { describe, expect, it } from "vitest";
import { computeStats } from "../src/engine/stats";
import type { ClosedTrade, EquityPoint } from "../src/engine/types";

function trade(pnl: number, closeTime: number, openTime = closeTime - 60): ClosedTrade {
  return {
    ticket: 1,
    symbol: "EURUSD",
    side: "buy",
    lots: 1,
    openPrice: 1.1,
    openTime,
    closePrice: 1.1,
    closeTime,
    pnl,
    swap: 0,
    commission: 0,
    reason: "manual",
    comment: "",
  };
}

describe("computeStats", () => {
  it("computes profit factor, win rate and expectancy", () => {
    const trades = [trade(100, 100), trade(10, 200), trade(-40, 300)];
    const stats = computeStats(10_000, trades, []);
    expect(stats.netProfit).toBeCloseTo(70);
    expect(stats.grossProfit).toBeCloseTo(110);
    expect(stats.grossLoss).toBeCloseTo(40);
    expect(stats.profitFactor).toBeCloseTo(110 / 40);
    expect(stats.winRate).toBeCloseTo((2 / 3) * 100);
    expect(stats.avgWin).toBeCloseTo(55);
    expect(stats.avgLoss).toBeCloseTo(40);
    expect(stats.expectancy).toBeCloseTo(70 / 3);
    expect(stats.maxConsecutiveWins).toBe(2);
    expect(stats.maxConsecutiveLosses).toBe(1);
  });

  it("handles no losing trades with infinite profit factor", () => {
    const stats = computeStats(10_000, [trade(50, 100)], []);
    expect(stats.profitFactor).toBe(Number.POSITIVE_INFINITY);
    expect(stats.maxConsecutiveLosses).toBe(0);
  });

  it("computes drawdown from the equity curve", () => {
    const curve: EquityPoint[] = [
      { ts: 1, balance: 10_000, equity: 10_000, margin: 0 },
      { ts: 2, balance: 10_000, equity: 10_100, margin: 0 },
      { ts: 3, balance: 10_000, equity: 10_060, margin: 0 },
      { ts: 4, balance: 10_000, equity: 10_050, margin: 0 },
      { ts: 5, balance: 10_000, equity: 10_070, margin: 0 },
    ];
    const stats = computeStats(10_000, [trade(10, 200)], curve);
    expect(stats.maxDrawdownAbs).toBeCloseTo(50);
    expect(stats.maxDrawdownPct).toBeCloseTo((50 / 10_100) * 100);
  });

  it("groups trades into monthly buckets", () => {
    const jan = Date.UTC(2025, 0, 15) / 1000;
    const feb = Date.UTC(2025, 1, 15) / 1000;
    const stats = computeStats(10_000, [trade(100, jan), trade(-40, jan + 60), trade(10, feb)], []);
    expect(stats.monthly).toHaveLength(2);
    expect(stats.monthly[0].month).toBe("2025-01");
    expect(stats.monthly[0].netPnl).toBeCloseTo(60);
    expect(stats.monthly[0].trades).toBe(2);
    expect(stats.monthly[1].month).toBe("2025-02");
    expect(stats.monthly[1].netPnl).toBeCloseTo(10);
  });

  it("reports return percentage", () => {
    const stats = computeStats(10_000, [trade(500, 100)], []);
    expect(stats.returnPct).toBeCloseTo(5);
    expect(stats.finalBalance).toBeCloseTo(10_500);
  });
});
