import type { ClosedTrade, EquityPoint } from "./types";

export interface MonthlyStat {
  /** UTC month key, `YYYY-MM`. */
  month: string;
  netPnl: number;
  trades: number;
  wins: number;
}

export interface Stats {
  initialBalance: number;
  finalBalance: number;
  netProfit: number;
  grossProfit: number;
  grossLoss: number;
  /** Gross profit / gross loss; Infinity when there are no losing trades. */
  profitFactor: number;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** Percentage in [0, 100]. */
  winRate: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  maxDrawdownAbs: number;
  /** Percentage of the preceding equity peak. */
  maxDrawdownPct: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  totalCommission: number;
  totalSwap: number;
  returnPct: number;
  startTs: number | null;
  endTs: number | null;
  monthly: MonthlyStat[];
}

const monthKey = (ts: number): string => new Date(ts * 1000).toISOString().slice(0, 7);

export function computeStats(
  initialBalance: number,
  trades: ClosedTrade[],
  equityCurve: EquityPoint[],
): Stats {
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let totalCommission = 0;
  let totalSwap = 0;
  let maxConsecWins = 0;
  let maxConsecLosses = 0;
  let consecWins = 0;
  let consecLosses = 0;
  const months = new Map<string, MonthlyStat>();

  for (const t of trades) {
    totalCommission += t.commission;
    totalSwap += t.swap;
    if (t.pnl > 0) {
      wins++;
      grossProfit += t.pnl;
      consecWins++;
      consecLosses = 0;
    } else if (t.pnl < 0) {
      losses++;
      grossLoss += Math.abs(t.pnl);
      consecLosses++;
      consecWins = 0;
    } else {
      breakeven++;
      consecWins = 0;
      consecLosses = 0;
    }
    maxConsecWins = Math.max(maxConsecWins, consecWins);
    maxConsecLosses = Math.max(maxConsecLosses, consecLosses);

    const key = monthKey(t.closeTime);
    const m = months.get(key) ?? { month: key, netPnl: 0, trades: 0, wins: 0 };
    m.netPnl += t.pnl;
    m.trades += 1;
    if (t.pnl > 0) m.wins += 1;
    months.set(key, m);
  }

  const netProfit = grossProfit - grossLoss;
  const totalTrades = trades.length;
  const finalBalance = initialBalance + netProfit;

  let peak = initialBalance;
  let maxDdAbs = 0;
  let maxDdPct = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak - p.equity;
    if (dd > maxDdAbs) maxDdAbs = dd;
    if (peak > 0) maxDdPct = Math.max(maxDdPct, (dd / peak) * 100);
  }

  const first = trades[0];
  const last = trades[trades.length - 1];

  return {
    initialBalance,
    finalBalance,
    netProfit,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0,
    totalTrades,
    wins,
    losses,
    breakeven,
    winRate: totalTrades > 0 ? (wins / totalTrades) * 100 : 0,
    avgWin: wins > 0 ? grossProfit / wins : 0,
    avgLoss: losses > 0 ? grossLoss / losses : 0,
    expectancy: totalTrades > 0 ? netProfit / totalTrades : 0,
    maxDrawdownAbs: maxDdAbs,
    maxDrawdownPct: maxDdPct,
    maxConsecutiveWins: maxConsecWins,
    maxConsecutiveLosses: maxConsecLosses,
    totalCommission,
    totalSwap,
    returnPct: initialBalance > 0 ? (netProfit / initialBalance) * 100 : 0,
    startTs: first ? first.openTime : null,
    endTs: last ? last.closeTime : null,
    monthly: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}
