import { describe, expect, it } from "vitest";
import { parseDataFile } from "../src/data/parse";

async function gzipBytes(content: string): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  await writer.write(new TextEncoder().encode(content));
  await writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}

function makeFile(bytes: Uint8Array | string, name: string, type = "application/octet-stream"): File {
  const part: BlobPart =
    typeof bytes === "string" ? bytes : (bytes.slice().buffer as ArrayBuffer);
  return new File([part], name, { type });
}

const jsonRows = [
  { ts: 1735689600, o: 0.61804, h: 0.61939, l: 0.61796, c: 0.6193, ao: 0.61809, ah: 0.61944, al: 0.61801, ac: 0.61935, v: 100 },
  { ts: 1735776000, o: 0.6193, h: 0.62223, l: 0.61878, c: 0.62006, ao: 0.61935, ah: 0.62228, al: 0.61883, ac: 0.62011, v: 200 },
];

describe("evtradelabs JSON.gz", () => {
  it("parses bid+ask candles and infers the symbol from the filename", async () => {
    const file = makeFile(await gzipBytes(JSON.stringify(jsonRows)), "AUDUSD_M5_2025.json.gz", "application/gzip");
    const { symbol, bars } = await parseDataFile(file);
    expect(symbol).toBe("AUDUSD");
    expect(bars).toHaveLength(2);
    expect(bars[0].ts).toBe(1735689600);
    expect(bars[0].bid.o).toBeCloseTo(0.61804);
    expect(bars[0].bid.c).toBeCloseTo(0.6193);
    expect(bars[0].ask.o).toBeCloseTo(0.61809);
    expect(bars[0].ask.c).toBeCloseTo(0.61935);
    expect(bars[0].volume).toBe(100);
  });

  it("sorts rows and keeps the last value for duplicate timestamps", async () => {
    const rows = [
      { ...jsonRows[0], c: 0.6 },
      { ...jsonRows[0], c: 0.65 },
      { ...jsonRows[1] },
    ];
    const file = makeFile(JSON.stringify(rows), "EURUSD_H1_2025.json");
    const { bars } = await parseDataFile(file);
    expect(bars).toHaveLength(2);
    expect(bars[0].ts).toBe(1735689600);
    expect(bars[0].bid.c).toBeCloseTo(0.65);
    expect(bars[1].ts).toBe(1735776000);
  });

  it("accepts wrapped JSON objects", async () => {
    const file = makeFile(JSON.stringify({ symbol: "EURUSD", bars: jsonRows }), "data.json");
    const { bars } = await parseDataFile(file);
    expect(bars).toHaveLength(2);
  });
});

describe("CSV parsing", () => {
  it("parses MT4-style Date;Time semicolon exports and treats them as UTC", async () => {
    const csv = [
      "Date;Time;Open;High;Low;Close;Volume",
      "2025.01.06;00:00;1.10000;1.10050;1.09950;1.10020;123",
      "2025.01.06;00:05;1.10020;1.10070;1.09990;1.10040;456",
    ].join("\n");
    const { bars, warnings } = await parseDataFile(makeFile(csv, "EURUSD_M5_2025.csv"));
    expect(bars).toHaveLength(2);
    expect(bars[0].ts).toBe(Date.UTC(2025, 0, 6, 0, 0, 0) / 1000);
    expect(bars[0].bid.c).toBeCloseTo(1.1002);
    expect(bars[0].ask.c).toBeCloseTo(1.1002); // no ask columns -> spread 0
    expect(warnings.some((w) => w.includes("spread"))).toBe(true);
  });

  it("parses timestamp + bid + ask columns", async () => {
    const csv = [
      "time,open,high,low,close,ao,ah,al,ac,volume",
      "1735689600,0.61804,0.61939,0.61796,0.6193,0.61809,0.61944,0.61801,0.61935,100",
      "1735776000,0.6193,0.62223,0.61878,0.62006,0.61935,0.62228,0.61883,0.62011,200",
    ].join("\n");
    const { bars } = await parseDataFile(makeFile(csv, "AUDUSD_D1.csv"));
    expect(bars).toHaveLength(2);
    expect(bars[0].ask.o).toBeCloseTo(0.61809);
  });

  it("supports headerless positional CSVs", async () => {
    const csv = ["1735689600,1.1,1.2,1.0,1.15,10", "1735776000,1.15,1.3,1.1,1.2,20"].join("\n");
    const { bars, warnings } = await parseDataFile(makeFile(csv, "x.csv"));
    expect(bars).toHaveLength(2);
    expect(bars[0].bid.h).toBeCloseTo(1.2);
    expect(warnings.some((w) => w.includes("positional"))).toBe(true);
  });

  it("applies an assumed spread when the file has no ask prices", async () => {
    const csv = ["2025.01.06 00:00,1.1000,1.1005,1.0995,1.1002", "2025.01.06 00:05,1.1002,1.1007,1.0999,1.1004"].join("\n");
    const { bars } = await parseDataFile(makeFile(csv, "EURUSD.csv"), { assumeSpreadPips: 1.5 });
    expect(bars[0].ask.o - bars[0].bid.o).toBeCloseTo(1.5 * 0.0001, 10);
  });
});

describe("validation", () => {
  it("rejects ZIP archives with a helpful message", async () => {
    const file = makeFile("PK", "EURUSD_M1_2025.zip", "application/zip");
    await expect(parseDataFile(file)).rejects.toThrow(/ZIP/);
  });

  it("rejects files with no usable candles", async () => {
    const csv = "time,open,high,low,close\n1735689600,abc,def,ghi,jkl";
    await expect(parseDataFile(makeFile(csv, "x.csv"))).rejects.toThrow(/no usable candles/i);
  });

  it("rejects CSVs missing OHLC columns", async () => {
    const csv = "time,foo,bar\n1735689600,1,2";
    await expect(parseDataFile(makeFile(csv, "x.csv"))).rejects.toThrow(/columns not recognised/i);
  });
});
