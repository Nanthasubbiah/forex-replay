/** Standard Fibonacci retracement ratios (0% = swing start, 100% = swing end). */
export const RETRACEMENT_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export interface FibLevel {
  /** 0..1 ratio of the retracement. */
  ratio: number;
  /** Price at this level. */
  price: number;
  /** Human label, e.g. `61.8%`. */
  label: string;
  /** Golden-ratio level (61.8) gets the highlight colour. */
  golden: boolean;
}

function ratioLabel(ratio: number): string {
  if (ratio === 0) return "0%";
  if (ratio === 1) return "100%";
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Compute retracement levels between two swing prices.
 * `priceA` is the 0% anchor and `priceB` the 100% anchor; levels interpolate
 * linearly between them (works for both up and down swings).
 */
export function fibLevels(priceA: number, priceB: number): FibLevel[] {
  return RETRACEMENT_RATIOS.map((ratio) => ({
    ratio,
    price: priceA + (priceB - priceA) * ratio,
    label: ratioLabel(ratio),
    golden: ratio === 0.618,
  }));
}
