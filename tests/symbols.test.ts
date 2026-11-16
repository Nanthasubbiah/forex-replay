import { describe, expect, it } from "vitest";
import {
  baseSymbolCode,
  getSymbolSpec,
  inferSymbolFromFilename,
  isValidSymbol,
  normalizeSymbol,
} from "../src/engine/symbols";

describe("normalizeSymbol", () => {
  it("trims and upper-cases user input", () => {
    expect(normalizeSymbol("  gbpusd ")).toBe("GBPUSD");
  });
});

describe("isValidSymbol", () => {
  it("accepts plain and broker-suffixed codes", () => {
    for (const code of ["EURUSD", "gbpusd", "GBPUSD.a", "XAUUSDm", "US30", "BRENT"]) {
      expect(isValidSymbol(code)).toBe(true);
    }
  });

  it("rejects empty or junk input", () => {
    for (const code of ["", " ", "G", "GBP USD$$$", "!!!!"]) {
      expect(isValidSymbol(code)).toBe(false);
    }
  });
});

describe("baseSymbolCode", () => {
  it("strips broker suffixes", () => {
    expect(baseSymbolCode("GBPUSD.a")).toBe("GBPUSD");
    expect(baseSymbolCode("XAUUSDm")).toBe("XAUUSD");
    expect(baseSymbolCode("eurusd-raw")).toBe("EURUSD");
  });

  it("returns null when the code is already plain or unknown", () => {
    expect(baseSymbolCode("GBPUSD")).toBeNull();
    expect(baseSymbolCode("GBPNZD")).toBeNull();
  });
});

describe("getSymbolSpec", () => {
  it("resolves the plain catalogue entry", () => {
    expect(getSymbolSpec("gbpusd").description).toBe("British Pound / US Dollar");
    expect(getSymbolSpec("GBPUSD").contractSize).toBe(100_000);
  });

  it("reuses the plain contract spec for broker-suffixed codes", () => {
    const spec = getSymbolSpec("GBPUSD.a");
    expect(spec.code).toBe("GBPUSD.A");
    expect(spec.description).toBe("British Pound / US Dollar");
    expect(spec.pipSize).toBe(0.0001);
    expect(spec.digits).toBe(5);

    expect(getSymbolSpec("XAUUSDm").digits).toBe(2);
    expect(getSymbolSpec("XAUUSDm").contractSize).toBe(100);
  });

  it("derives base/quote for an unknown 6-letter pair", () => {
    const spec = getSymbolSpec("GBPNZD");
    expect(spec.base).toBe("GBP");
    expect(spec.quote).toBe("NZD");
    expect(spec.pipSize).toBe(0.0001);
  });

  it("falls back to a generic spec for anything else", () => {
    expect(getSymbolSpec("US30").code).toBe("US30");
    expect(getSymbolSpec("US30").quote).toBe("USD");
  });
});

describe("inferSymbolFromFilename", () => {
  it("finds a catalogue code inside the file name", () => {
    expect(inferSymbolFromFilename("GBPUSD_M5_2025.json.gz")).toBe("GBPUSD");
    expect(inferSymbolFromFilename("2026.json.gz")).toBeNull();
  });
});
