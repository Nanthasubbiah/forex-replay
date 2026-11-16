import type { Bar, OHLC } from "../src/engine/types";

/** Monday 2025-01-06 00:00:00 UTC. */
export const T0 = Date.UTC(2025, 0, 6, 0, 0, 0) / 1000;

export function bar(
  ts: number,
  o: number,
  h: number,
  l: number,
  c: number,
  spread = 0.0002,
  volume = 100,
): Bar {
  const bid: OHLC = { o, h, l, c };
  const ask: OHLC = { o: o + spread, h: h + spread, l: l + spread, c: c + spread };
  return { ts, bid, ask, volume };
}

export function flatBar(ts: number, price = 1.1, spread = 0.0002): Bar {
  return bar(ts, price, price + 0.0002, price - 0.0002, price, spread);
}
