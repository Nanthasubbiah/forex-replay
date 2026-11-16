import type { Bar, OHLC } from "../engine/types";
import { getSymbolSpec } from "../engine/symbols";

export interface DemoOptions {
  symbol?: string;
  /** First bar timestamp (seconds). Defaults to `count` bars before now. */
  startTs?: number;
  /** Number of candles to generate. */
  count?: number;
  /** Candle interval in minutes. */
  tfMinutes?: number;
  startPrice?: number;
  /** Standard deviation of the per-bar price move, in pips. */
  volatilityPips?: number;
  seed?: number;
}

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sessionSpreadPips(hourUtc: number): number {
  if (hourUtc < 6) return 2.2;
  if (hourUtc < 9) return 1.4;
  if (hourUtc < 17) return 0.8;
  if (hourUtc < 21) return 1.1;
  return 1.9;
}

/** Generate a realistic synthetic FX dataset (weekends excluded, session spreads). */
export function generateDemoBars(opts: DemoOptions = {}): Bar[] {
  const symbol = opts.symbol ?? "EURUSD";
  const spec = getSymbolSpec(symbol);
  const tf = (opts.tfMinutes ?? 5) * 60;
  const count = opts.count ?? 6000;
  const pip = spec.pipSize;
  const vol = (opts.volatilityPips ?? 6) * pip;
  const rng = mulberry32(opts.seed ?? 42);
  const startTs = opts.startTs ?? Math.floor(Date.now() / 1000) - count * tf;
  const startPrice = opts.startPrice ?? 1.085;

  const bars: Bar[] = [];
  let price = startPrice;
  let t = Math.floor(startTs / tf) * tf;

  while (bars.length < count) {
    const day = new Date(t * 1000).getUTCDay();
    if (day === 0 || day === 6) {
      // Jump to next Monday 00:00 UTC.
      t += 86_400;
      continue;
    }
    const open = price;
    // Slow trend cycles + mean reversion + noise.
    const trend = Math.sin((t / 86_400) * 0.35) * 0.08 * vol;
    const drift = -((open - startPrice) / startPrice) * 0.05 * vol;
    const close = open + gauss(rng) * vol + trend + drift;
    const wickUp = Math.abs(gauss(rng)) * vol * 0.7;
    const wickDown = Math.abs(gauss(rng)) * vol * 0.7;
    const h = Math.max(open, close) + wickUp;
    const l = Math.min(open, close) - wickDown;
    const hour = new Date(t * 1000).getUTCHours();
    const spread = sessionSpreadPips(hour) * pip;
    const bid: OHLC = { o: open, h, l, c: close };
    const ask: OHLC = { o: open + spread, h: h + spread, l: l + spread, c: close + spread };
    bars.push({ ts: t, bid, ask, volume: 40 + rng() * 260 });
    price = close;
    t += tf;
  }
  return bars;
}
