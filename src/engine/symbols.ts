import type { SymbolSpec } from "./types";

/**
 * Contract specifications for every symbol in the evtradelabs catalogue.
 *
 * Contract sizes and pip sizes follow common retail MT4 broker conventions;
 * swap values are sane placeholder defaults (per lot, per night, account
 * currency) and are meant to be tuned by the user for their broker.
 */
export const SYMBOL_SPECS: Record<string, SymbolSpec> = {
  EURUSD: {
    code: "EURUSD", description: "Euro / US Dollar", base: "EUR", quote: "USD",
    contractSize: 100_000, digits: 5, pipSize: 0.0001,
    swapLong: -2.1, swapShort: 0.05, tripleSwapWeekday: 3,
  },
  GBPUSD: {
    code: "GBPUSD", description: "British Pound / US Dollar", base: "GBP", quote: "USD",
    contractSize: 100_000, digits: 5, pipSize: 0.0001,
    swapLong: -2.6, swapShort: 0.12, tripleSwapWeekday: 3,
  },
  USDJPY: {
    code: "USDJPY", description: "US Dollar / Japanese Yen", base: "USD", quote: "JPY",
    contractSize: 100_000, digits: 3, pipSize: 0.01,
    swapLong: 1.35, swapShort: -3.9, tripleSwapWeekday: 3,
  },
  AUDUSD: {
    code: "AUDUSD", description: "Australian Dollar / US Dollar", base: "AUD", quote: "USD",
    contractSize: 100_000, digits: 5, pipSize: 0.0001,
    swapLong: -0.9, swapShort: -0.85, tripleSwapWeekday: 3,
  },
  USDCHF: {
    code: "USDCHF", description: "US Dollar / Swiss Franc", base: "USD", quote: "CHF",
    contractSize: 100_000, digits: 5, pipSize: 0.0001,
    swapLong: 0.7, swapShort: -2.4, tripleSwapWeekday: 3,
  },
  EURGBP: {
    code: "EURGBP", description: "Euro / British Pound", base: "EUR", quote: "GBP",
    contractSize: 100_000, digits: 5, pipSize: 0.0001,
    swapLong: -0.9, swapShort: -0.45, tripleSwapWeekday: 3,
  },
  GBPJPY: {
    code: "GBPJPY", description: "British Pound / Japanese Yen", base: "GBP", quote: "JPY",
    contractSize: 100_000, digits: 3, pipSize: 0.01,
    swapLong: 2.2, swapShort: -6.5, tripleSwapWeekday: 3,
  },
  XAUUSD: {
    code: "XAUUSD", description: "Gold / US Dollar", base: "XAU", quote: "USD",
    contractSize: 100, digits: 2, pipSize: 0.1,
    swapLong: -3.2, swapShort: 0.9, tripleSwapWeekday: 3,
  },
  XAGUSD: {
    code: "XAGUSD", description: "Silver / US Dollar", base: "XAG", quote: "USD",
    contractSize: 5_000, digits: 3, pipSize: 0.001,
    swapLong: -0.35, swapShort: 0.05, tripleSwapWeekday: 3,
  },
  DJ: {
    code: "DJ", description: "Dow Jones 30 CFD", base: "DJ", quote: "USD",
    contractSize: 1, digits: 1, pipSize: 1,
    swapLong: -4.5, swapShort: 1.2, tripleSwapWeekday: 3,
  },
  NQ: {
    code: "NQ", description: "Nasdaq 100 CFD", base: "NQ", quote: "USD",
    contractSize: 1, digits: 2, pipSize: 1,
    swapLong: -4.9, swapShort: 1.1, tripleSwapWeekday: 3,
  },
  SP500: {
    code: "SP500", description: "S&P 500 CFD", base: "SP500", quote: "USD",
    contractSize: 1, digits: 2, pipSize: 1,
    swapLong: -3.8, swapShort: 0.9, tripleSwapWeekday: 3,
  },
  DAX: {
    code: "DAX", description: "DAX 40 CFD", base: "DAX", quote: "EUR",
    contractSize: 1, digits: 2, pipSize: 1,
    swapLong: -5.2, swapShort: 1.4, tripleSwapWeekday: 3,
  },
  FTSE: {
    code: "FTSE", description: "FTSE 100 CFD", base: "FTSE", quote: "GBP",
    contractSize: 1, digits: 2, pipSize: 1,
    swapLong: -2.1, swapShort: 0.6, tripleSwapWeekday: 3,
  },
  NIKKEI: {
    code: "NIKKEI", description: "Nikkei 225 CFD", base: "NIKKEI", quote: "JPY",
    contractSize: 1, digits: 2, pipSize: 1,
    swapLong: -1.2, swapShort: 0.3, tripleSwapWeekday: 3,
  },
  BTCUSD: {
    code: "BTCUSD", description: "Bitcoin / US Dollar", base: "BTC", quote: "USD",
    contractSize: 1, digits: 2, pipSize: 1,
    swapLong: -12.5, swapShort: 3.5, tripleSwapWeekday: 3,
  },
  ETHUSD: {
    code: "ETHUSD", description: "Ethereum / US Dollar", base: "ETH", quote: "USD",
    contractSize: 1, digits: 2, pipSize: 0.1,
    swapLong: -9.8, swapShort: 2.8, tripleSwapWeekday: 3,
  },
  BRENT: {
    code: "BRENT", description: "Brent Crude Oil CFD", base: "BRENT", quote: "USD",
    contractSize: 100, digits: 2, pipSize: 0.01,
    swapLong: -3.5, swapShort: 1.0, tripleSwapWeekday: 3,
  },
  WTI: {
    code: "WTI", description: "WTI Crude Oil CFD", base: "WTI", quote: "USD",
    contractSize: 100, digits: 2, pipSize: 0.01,
    swapLong: -3.3, swapShort: 1.1, tripleSwapWeekday: 3,
  },
};

export const SYMBOL_CODES = Object.keys(SYMBOL_SPECS);

/** Trims and upper-cases a user-typed symbol code (`" gbpusd "` → `"GBPUSD"`). */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Codes the symbol box accepts: 2–16 letters/digits, optionally followed by a
 * broker suffix (`GBPUSD.a`, `XAUUSDm`, `EURUSD-raw`).
 */
export function isValidSymbol(raw: string): boolean {
  return /^[A-Z0-9][A-Z0-9._#\-/]{1,15}$/.test(normalizeSymbol(raw));
}

/**
 * Strips a broker suffix so a catalogue entry can be reused:
 * `GBPUSD.a` → `GBPUSD`, `XAUUSDm` → `XAUUSD`. Null when nothing matches.
 */
export function baseSymbolCode(raw: string): string | null {
  const code = normalizeSymbol(raw);
  let best: string | null = null;
  for (const candidate of SYMBOL_CODES) {
    if (code.length > candidate.length && code.startsWith(candidate)) {
      if (best == null || candidate.length > best.length) best = candidate;
    }
  }
  return best;
}

/**
 * Best-effort symbol detection from a filename such as
 * `AUDUSD_M5_2025.json.gz` or `XAUUSD-2024.csv`.
 */
export function inferSymbolFromFilename(name: string): string | null {
  const upper = name.toUpperCase();
  for (const code of SYMBOL_CODES) {
    if (upper.includes(code)) return code;
  }
  return null;
}

export function getSymbolSpec(code: string): SymbolSpec {
  const upper = normalizeSymbol(code);
  const spec = SYMBOL_SPECS[upper];
  if (spec) return spec;
  // Broker-suffixed codes ("GBPUSD.a", "XAUUSDm") reuse the plain contract spec
  // but keep the user's own code for display.
  const base = baseSymbolCode(upper);
  if (base) return { ...SYMBOL_SPECS[base], code: upper };
  // Fallback: derive base/quote from a 6-letter code, else generic USD spec.
  if (/^[A-Z]{6}$/.test(upper)) {
    return {
      code: upper, description: upper, base: upper.slice(0, 3), quote: upper.slice(3),
      contractSize: 100_000, digits: 5, pipSize: 0.0001,
      swapLong: 0, swapShort: 0, tripleSwapWeekday: 3,
    };
  }
  return {
    code: upper, description: upper, base: upper, quote: "USD",
    contractSize: 100_000, digits: 5, pipSize: 0.0001,
    swapLong: 0, swapShort: 0, tripleSwapWeekday: 3,
  };
}
