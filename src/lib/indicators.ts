/**
 * Indicator math plus the generic incremental cache used by the chart.
 *
 * Every indicator is a pure batch function over the first `count` bars — the
 * chart only keeps a small cache and recomputes the prefix when the replay
 * advances or the settings change, so indicators never look at future bars.
 */
import type { Bar } from "../engine/types";

export type MaType = "sma" | "ema";

export const MIN_MA_PERIOD = 1;
export const MAX_MA_PERIOD = 5000;

export const MA_COLOR_PRESETS = ["#f59e0b", "#22d3ee", "#a78bfa", "#34d399", "#f87171", "#e5e7eb"];

export function maLabel(ma: { period: number; type: MaType }): string {
  return `${ma.type === "ema" ? "EMA" : "SMA"} ${ma.period}`;
}

/** Clamp keystroke input to a whole number of bars; `null` when unusable. */
export function normalizePeriod(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  const period = Math.round(raw);
  if (period < MIN_MA_PERIOD || period > MAX_MA_PERIOD) return null;
  return period;
}

/** Bound distance in pips must be a finite, non-negative number. */
export function normalizeBoundPips(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  if (raw < 0 || raw > 1_000_000) return null;
  return raw;
}

/** Closing prices of the first `count` bars. */
export function closesOf(bars: Bar[], count: number): number[] {
  const n = Math.max(0, Math.min(count, bars.length));
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = bars[i].bid.c;
  return out;
}

/**
 * Full moving-average series over `values` (one entry per input value).
 * Entries before the first full window are `null`.
 */
export function computeMovingAverage(values: number[], period: number, type: MaType): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const p = Math.max(1, Math.floor(period));
  if (type === "sma") {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= p) sum -= values[i - p];
      if (i >= p - 1) out[i] = sum / p;
    }
    return out;
  }
  if (values.length < p) return out;
  let seed = 0;
  for (let i = 0; i < p; i++) seed += values[i];
  let ema = seed / p;
  out[p - 1] = ema;
  const k = 2 / (p + 1);
  for (let i = p; i < values.length; i++) {
    ema += k * (values[i] - ema);
    out[i] = ema;
  }
  return out;
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Wilder's RSI over the first `count` closes; first value at index `period`. */
export function computeRsi(bars: Bar[], count: number, period: number): (number | null)[] {
  const n = Math.max(0, Math.min(count, bars.length));
  const p = Math.max(1, Math.floor(period));
  const out: (number | null)[] = new Array(n).fill(null);
  if (n <= p) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= p; i++) {
    const diff = bars[i].bid.c - bars[i - 1].bid.c;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / p;
  let avgLoss = loss / p;
  out[p] = rsiFrom(avgGain, avgLoss);
  for (let i = p + 1; i < n; i++) {
    const diff = bars[i].bid.c - bars[i - 1].bid.c;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (p - 1) + g) / p;
    avgLoss = (avgLoss * (p - 1) + l) / p;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

/** Wilder's ATR (true range smoothed over `period`); first value at `period - 1`. */
export function computeAtr(bars: Bar[], count: number, period: number): (number | null)[] {
  const n = Math.max(0, Math.min(count, bars.length));
  const p = Math.max(1, Math.floor(period));
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < p) return out;
  const tr = (i: number): number => {
    const b = bars[i].bid;
    if (i === 0) return b.h - b.l;
    const prev = bars[i - 1].bid.c;
    return Math.max(b.h - b.l, Math.abs(b.h - prev), Math.abs(b.l - prev));
  };
  let sum = 0;
  for (let i = 0; i < p; i++) sum += tr(i);
  let atr = sum / p;
  out[p - 1] = atr;
  for (let i = p; i < n; i++) {
    atr = (atr * (p - 1) + tr(i)) / p;
    out[i] = atr;
  }
  return out;
}

export interface BollingerSeries {
  basis: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

/** SMA basis ± `deviation` population standard deviations. */
export function computeBollinger(bars: Bar[], count: number, period: number, deviation: number): BollingerSeries {
  const n = Math.max(0, Math.min(count, bars.length));
  const p = Math.max(2, Math.floor(period));
  const k = Math.max(0, deviation);
  const basis: (number | null)[] = new Array(n).fill(null);
  const upper: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const close = bars[i].bid.c;
    sum += close;
    sumSq += close * close;
    if (i >= p) {
      const old = bars[i - p].bid.c;
      sum -= old;
      sumSq -= old * old;
    }
    if (i >= p - 1) {
      const mean = sum / p;
      const variance = Math.max(0, sumSq / p - mean * mean);
      const sd = Math.sqrt(variance);
      basis[i] = mean;
      upper[i] = mean + k * sd;
      lower[i] = mean - k * sd;
    }
  }
  return { basis, upper, lower };
}

export interface MacdSeries {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
}

/** MACD line, signal line and histogram over the first `count` closes. */
export function computeMacd(bars: Bar[], count: number, fast: number, slow: number, signal: number): MacdSeries {
  const n = Math.max(0, Math.min(count, bars.length));
  const closes = closesOf(bars, n);
  const fastEma = computeMovingAverage(closes, Math.max(1, fast), "ema");
  const slowEma = computeMovingAverage(closes, Math.max(1, slow), "ema");
  const macd: (number | null)[] = new Array(n).fill(null);
  let firstMacd = -1;
  for (let i = 0; i < n; i++) {
    if (fastEma[i] != null && slowEma[i] != null) {
      macd[i] = (fastEma[i] as number) - (slowEma[i] as number);
      if (firstMacd < 0) firstMacd = i;
    }
  }
  const sig: (number | null)[] = new Array(n).fill(null);
  const hist: (number | null)[] = new Array(n).fill(null);
  if (firstMacd >= 0) {
    const valid: number[] = [];
    for (let i = firstMacd; i < n; i++) valid.push(macd[i] as number);
    const sigValid = computeMovingAverage(valid, Math.max(1, signal), "ema");
    for (let j = 0; j < valid.length; j++) {
      if (sigValid[j] != null) sig[firstMacd + j] = sigValid[j] as number;
    }
    for (let i = 0; i < n; i++) {
      if (macd[i] != null && sig[i] != null) hist[i] = (macd[i] as number) - (sig[i] as number);
    }
  }
  return { macd, signal: sig, hist };
}

// ----------------------------------------------------------- generic cache

export interface IndicatorValuesCache {
  barsRef: Bar[] | null;
  /** Signature of kind + params + pip size; a change restarts the cache. */
  sig: string;
  /** Number of bars the cached values cover. */
  count: number;
  values: Record<string, (number | null)[]>;
}

export function createIndicatorValuesCache(): IndicatorValuesCache {
  return { barsRef: null, sig: "", count: 0, values: {} };
}

/**
 * Make sure `cache` holds values for the first `count` bars. `compute` is
 * called only when the signature changes, the bars change, the replay rewinds
 * or the title grows — a cached frame is free.
 */
export function ensureIndicatorValues(
  cache: IndicatorValuesCache,
  bars: Bar[],
  sig: string,
  count: number,
  compute: () => Record<string, (number | null)[]>,
): Record<string, (number | null)[]> {
  const n = Math.max(0, Math.min(count, bars.length));
  if (cache.barsRef !== bars || cache.sig !== sig || cache.count > n) {
    cache.barsRef = bars;
    cache.sig = sig;
    cache.count = 0;
    cache.values = {};
  }
  if (cache.count < n) {
    cache.values = compute();
    cache.count = n;
  }
  return cache.values;
}
