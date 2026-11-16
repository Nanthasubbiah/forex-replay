import { describe, expect, it, vi } from "vitest";
import {
  computeAtr,
  computeBollinger,
  computeMacd,
  computeMovingAverage,
  computeRsi,
  createIndicatorValuesCache,
  ensureIndicatorValues,
  maLabel,
  normalizeBoundPips,
  normalizePeriod,
} from "../src/lib/indicators";
import {
  createIndicatorInstance,
  indicatorOutputs,
  indicatorSignature,
  indicatorTitle,
} from "../src/lib/indicatorRegistry";
import type { Bar } from "../src/engine/types";

function mkBars(closes: number[]): Bar[] {
  return closes.map((close, i) => ({
    ts: 1_700_000_000 + i * 300,
    bid: { o: close, h: close, l: close, c: close },
    ask: { o: close, h: close, l: close, c: close },
    volume: 1,
  }));
}

/** Bars with a fixed 0.2 high-low range around each close. */
function mkRangedBars(closes: number[]): Bar[] {
  return closes.map((close, i) => ({
    ts: 1_700_000_000 + i * 300,
    bid: { o: close, h: close + 0.1, l: close - 0.1, c: close },
    ask: { o: close, h: close + 0.1, l: close - 0.1, c: close },
    volume: 1,
  }));
}

const series = (closes: number[], period: number, type: "sma" | "ema") => computeMovingAverage(closes, period, type);

describe("computeMovingAverage", () => {
  it("computes a simple moving average with warm-up nulls", () => {
    expect(series([1, 2, 3, 4, 5, 6], 3, "sma")).toEqual([null, null, 2, 3, 4, 5]);
  });

  it("computes an exponential moving average seeded by the first SMA", () => {
    const ema = series([1, 2, 3, 10], 3, "ema");
    expect(ema[0]).toBeNull();
    expect(ema[1]).toBeNull();
    expect(ema[2]).toBeCloseTo(2);
    expect(ema[3]).toBeCloseTo(6); // 2 + 0.5 * (10 - 2)
  });

  it("matches the input for a period of one", () => {
    expect(series([4, 7, 1], 1, "sma")).toEqual([4, 7, 1]);
    expect(series([4, 7, 1], 1, "ema")).toEqual([4, 7, 1]);
  });

  it("returns only warm-up nulls when the period exceeds the history", () => {
    expect(series([1, 2, 3], 5, "sma")).toEqual([null, null, null]);
    expect(series([1, 2, 3], 5, "ema")).toEqual([null, null, null]);
  });
});

describe("computeRsi", () => {
  it("is 100 for a purely rising series and null during warm-up", () => {
    const bars = mkBars([1, 2, 3, 4, 5, 6]);
    expect(computeRsi(bars, bars.length, 3)).toEqual([null, null, null, 100, 100, 100]);
  });

  it("is 0 for a falling series and 50 when nothing moves", () => {
    expect(computeRsi(mkBars([6, 5, 4, 3]), 4, 3)[3]).toBeCloseTo(0);
    expect(computeRsi(mkBars([2, 2, 2, 2, 2]), 5, 3)[4]).toBeCloseTo(50);
  });

  it("returns nulls while the history is shorter than the period", () => {
    expect(computeRsi(mkBars([1, 2]), 2, 14)).toEqual([null, null]);
  });
});

describe("computeAtr", () => {
  it("averages the true range and smooths it with Wilder's recursion", () => {
    const bars = mkRangedBars([1.1, 1.1, 1.1, 1.1, 1.1]);
    const atr = computeAtr(bars, 5, 3);
    expect(atr[0]).toBeNull();
    expect(atr[1]).toBeNull();
    expect(atr[2]).toBeCloseTo(0.2);
    expect(atr[3]).toBeCloseTo(0.2);
    expect(atr[4]).toBeCloseTo(0.2);
  });

  it("uses the gap to the previous close in the true range", () => {
    const bars = mkRangedBars([1.0, 2.0, 2.0]);
    // bar 1: max(0.2, |2.1 - 1.0|, |1.9 - 1.0|) = 1.1
    const atr = computeAtr(bars, 2, 2);
    expect(atr[1]).toBeCloseTo((0.2 + 1.1) / 2);
  });
});

describe("computeBollinger", () => {
  it("wraps the SMA in ±k population standard deviations", () => {
    const close = computeBollinger(mkBars([1, 2, 3, 4]), 4, 3, 2);
    const sd = Math.sqrt(2 / 3);
    expect(close.basis).toEqual([null, null, 2, 3]);
    expect(close.upper[2]).toBeCloseTo(2 + 2 * sd);
    expect(close.lower[2]).toBeCloseTo(2 - 2 * sd);
    expect(close.upper[3]).toBeCloseTo(3 + 2 * sd);
  });
});

describe("computeMacd", () => {
  const bars = mkBars([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  it("starts the line, signal and histogram after their warm-ups", () => {
    const macd = computeMacd(bars, bars.length, 2, 3, 2);
    expect(macd.macd[0]).toBeNull();
    expect(macd.macd[1]).toBeNull();
    expect(macd.macd[2]).not.toBeNull();
    expect(macd.signal[2]).toBeNull();
    expect(macd.signal[3]).not.toBeNull();
    expect(macd.hist[3]).not.toBeNull();
    expect(macd.hist[3]).toBeCloseTo((macd.macd[3] as number) - (macd.signal[3] as number));
  });

  it("is the difference of the fast and slow EMAs", () => {
    const macd = computeMacd(bars, bars.length, 2, 3, 2);
    const fast = computeMovingAverage(bars.map((b) => b.bid.c), 2, "ema");
    const slow = computeMovingAverage(bars.map((b) => b.bid.c), 3, "ema");
    expect(macd.macd[5]).toBeCloseTo((fast[5] as number) - (slow[5] as number));
  });
});

describe("incremental indicator cache", () => {
  const closes = [1, 3, 2, 8, 5, 13, 21, 34, 55, 89];
  const bars = mkBars(closes);
  const reference = (count: number) => computeMovingAverage(closes.slice(0, count), 4, "sma");

  it("equals the reference series when built one bar at a time", () => {
    const cache = createIndicatorValuesCache();
    let values: (number | null)[] = [];
    for (let count = 1; count <= bars.length; count++) {
      values = ensureIndicatorValues(cache, bars, "ma:4:sma", count, () => ({
        ma: reference(count),
      })).ma;
    }
    expect(values).toEqual(reference(bars.length));
  });

  it("reuses the cached values while the bar count and signature hold", () => {
    const cache = createIndicatorValuesCache();
    const compute = vi.fn(() => ({ ma: reference(3) }));
    ensureIndicatorValues(cache, bars, "sig", 3, compute);
    ensureIndicatorValues(cache, bars, "sig", 3, compute);
    expect(compute).toHaveBeenCalledTimes(1);
    ensureIndicatorValues(cache, bars, "sig", 5, () => ({ ma: reference(5) }));
    ensureIndicatorValues(cache, bars, "other", 5, () => ({ ma: reference(5) }));
    const rewound = ensureIndicatorValues(cache, bars, "other", 2, () => ({ ma: reference(2) }));
    expect(rewound.ma).toEqual(reference(2));
  });
});

describe("indicator registry", () => {
  it("creates instances with registry defaults", () => {
    const macd = createIndicatorInstance("macd", 5);
    expect(macd.params).toEqual({ fast: 12, slow: 26, signal: 9 });
    expect(indicatorTitle(macd)).toBe("MACD 12,26,9");
    expect(createIndicatorInstance("ma", 1).params.period).toBe(20);
  });

  it("describes outputs for the renderer", () => {
    const plain = createIndicatorInstance("ma", 1);
    expect(indicatorOutputs(plain).map((o) => o.key)).toEqual(["ma"]);

    const fancy = createIndicatorInstance("ma", 2);
    fancy.params = { ...fancy.params, colored: 1, showBounds: 1 };
    const outputs = indicatorOutputs(fancy);
    expect(outputs.map((o) => o.key)).toEqual(["ma", "upper", "lower"]);
    expect(outputs[0].upColor).toBe(fancy.colors.up);
    expect(outputs[1].dashed).toBe(true);
  });

  it("computes pip-shifted MA bounds", () => {
    const ma = createIndicatorInstance("ma", 1);
    ma.params = { ...ma.params, period: 2, showBounds: 1, boundPips: 10 };
    const values = computeMovingAverage([1, 3, 5], 2, "sma");
    expect(values).toEqual([null, 2, 4]);
    const upper = (values[1] as number) + 10 * 0.0001;
    expect(upper).toBeCloseTo(2.001);
    expect(indicatorSignature(ma, 0.0001)).toBe(`ma|${JSON.stringify(ma.params)}|0.0001`);
  });

  it("titles RSI, ATR and Bollinger instances", () => {
    expect(indicatorTitle(createIndicatorInstance("rsi", 3))).toBe("RSI 14");
    expect(indicatorTitle(createIndicatorInstance("atr", 4))).toBe("ATR 14");
    expect(indicatorTitle(createIndicatorInstance("bollinger", 5))).toBe("BB 20, 2");
    expect(maLabel({ period: 50, type: "ema" })).toBe("EMA 50");
  });
});

describe("indicator input helpers", () => {
  it("normalizes periods to whole bars within range", () => {
    expect(normalizePeriod(20)).toBe(20);
    expect(normalizePeriod(12.6)).toBe(13);
    expect(normalizePeriod(0)).toBeNull();
    expect(normalizePeriod(-2)).toBeNull();
    expect(normalizePeriod(Number.NaN)).toBeNull();
    expect(normalizePeriod(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizePeriod(6000)).toBeNull();
  });

  it("accepts non-negative pip bounds only", () => {
    expect(normalizeBoundPips(0)).toBe(0);
    expect(normalizeBoundPips(10.5)).toBe(10.5);
    expect(normalizeBoundPips(-1)).toBeNull();
    expect(normalizeBoundPips(Number.NaN)).toBeNull();
  });
});
