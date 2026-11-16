import type { Bar, OHLC } from "../engine/types";
import { inferSymbolFromFilename } from "../engine/symbols";

export interface ParsedData {
  symbol: string | null;
  bars: Bar[];
  warnings: string[];
}

export interface ParseOptions {
  /** Spread to synthesise (in pips) when the file contains bid prices only. */
  assumeSpreadPips?: number;
  defaultSymbol?: string;
}

const MAX_REASONABLE_MS = 1e11;
const DELIMS = [",", ";", "\t"];

async function gunzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

function isGzip(bytes: ArrayBuffer): boolean {
  const view = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  return view.length === 2 && view[0] === 0x1f && view[1] === 0x8b;
}

/** Parse a downloaded data file (JSON.gz, JSON or CSV) into normalised bars. */
export async function parseDataFile(file: File, opts?: ParseOptions): Promise<ParsedData> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) {
    throw new Error(
      "ZIP archives are not supported yet — unzip the download and load the .json.gz or .csv file inside.",
    );
  }

  let bytes = await file.arrayBuffer();
  if (isGzip(bytes)) bytes = await gunzip(bytes);
  const text = new TextDecoder("utf-8").decode(bytes);
  const trimmed = text.trimStart();

  const warnings: string[] = [];
  const rows = trimmed.startsWith("[") || trimmed.startsWith("{") ? parseJsonRows(trimmed) : parseCsvRows(trimmed, warnings);

  const bars = normaliseBars(rows, opts?.assumeSpreadPips ?? 0, warnings);
  const symbol = inferSymbolFromFilename(file.name) ?? opts?.defaultSymbol ?? null;
  return { symbol, bars, warnings };
}

// ------------------------------------------------------------------ JSON

interface RowInput {
  o: number | string | undefined;
  h: number | string | undefined;
  l: number | string | undefined;
  c: number | string | undefined;
  ao?: number | string;
  ah?: number | string;
  al?: number | string;
  ac?: number | string;
  v: number | string | undefined;
  ts: number | string | undefined;
}

function parseJsonRows(text: string): unknown[] {
  const parsed: unknown = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.bars)) return obj.bars;
    if (Array.isArray(obj.data)) return obj.data;
  }
  throw new Error("JSON file does not contain an array of candles");
}

// ------------------------------------------------------------------- CSV

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delim && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectDelimiter(lines: string[]): string {
  let best = ",";
  let bestScore = 0;
  for (const d of DELIMS) {
    const counts = lines.slice(0, 5).map((l) => splitCsvLine(l, d).length);
    const score = counts.reduce((a, b) => a + b, 0) / counts.length;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function isNumeric(s: string): boolean {
  return s !== "" && !Number.isNaN(Number(s));
}

function looksLikeDate(s: string): boolean {
  return /^\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(s) || /^\d{8}$/.test(s);
}

function looksLikeTime(s: string): boolean {
  return /^\d{1,2}:\d{2}/.test(s);
}

function parseCsvRows(text: string, warnings: string[]): unknown[] {
  const rawLines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (rawLines.length === 0) throw new Error("CSV file is empty");
  const delim = detectDelimiter(rawLines);
  const table = rawLines.map((l) => splitCsvLine(l, delim));
  const first = table[0];

  const headerMap = mapHeader(first);
  if (headerMap) {
    return parseWithHeader(table.slice(1), headerMap);
  }
  if (first.some((c) => /[a-z]/i.test(c))) {
    throw new Error(
      "CSV columns not recognised — expected a time/date column plus open/high/low/close (and optional ask columns)",
    );
  }

  warnings.push("CSV has no recognisable header — using positional columns");
  return parsePositional(table);
}

type ColMap = {
  ts: number;
  dateOnly: number;
  timeOnly: number;
  open: number;
  high: number;
  low: number;
  close: number;
  ao: number;
  ah: number;
  al: number;
  ac: number;
  volume: number;
};

function mapHeader(cells: string[]): ColMap | null {
  const h = cells.map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const idx = (aliases: string[]): number => h.findIndex((x) => aliases.includes(x));
  const m: ColMap = {
    ts: idx(["ts", "timestamp", "unix", "unixtime"]),
    dateOnly: idx(["date", "day"]),
    timeOnly: idx(["time"]),
    open: idx(["o", "open", "bidopen"]),
    high: idx(["h", "high", "bidhigh"]),
    low: idx(["l", "low", "bidlow"]),
    close: idx(["c", "close", "bidclose"]),
    ao: idx(["ao", "aopen", "askopen"]),
    ah: idx(["ah", "ahigh", "askhigh"]),
    al: idx(["al", "alow", "asklow"]),
    ac: idx(["ac", "aclose", "askclose"]),
    volume: idx(["v", "volume", "tickvolume", "tickvol", "vol"]),
  };
  if (m.open === -1 || m.high === -1 || m.low === -1 || m.close === -1) return null;
  if (m.ts === -1 && m.dateOnly === -1 && m.timeOnly === -1) return null;
  return m;
}

function rowFromCells(cells: string[], m: ColMap): RowInput | null {
  const val = (i: number): string | undefined => (i >= 0 ? cells[i] : undefined);
  let ts: string | undefined;
  if (m.ts !== -1) {
    ts = val(m.ts);
  } else if (m.dateOnly !== -1) {
    ts = `${val(m.dateOnly) ?? ""} ${m.timeOnly !== -1 ? val(m.timeOnly) ?? "" : ""}`.trim();
  } else {
    ts = val(m.timeOnly);
  }
  if (!ts) return null;
  return {
    ts,
    o: val(m.open),
    h: val(m.high),
    l: val(m.low),
    c: val(m.close),
    ao: m.ao !== -1 ? val(m.ao) : undefined,
    ah: m.ah !== -1 ? val(m.ah) : undefined,
    al: m.al !== -1 ? val(m.al) : undefined,
    ac: m.ac !== -1 ? val(m.ac) : undefined,
    v: m.volume !== -1 ? val(m.volume) : undefined,
  };
}

function parseWithHeader(rows: string[][], m: ColMap): unknown[] {
  const out: unknown[] = [];
  for (const cells of rows) {
    const row = rowFromCells(cells, m);
    if (row) out.push(row);
  }
  return out;
}

/**
 * Headerless fallback. Supported shapes:
 *   date,time,open,high,low,close,volume
 *   timestamp,open,high,low,close[,volume]
 */
function parsePositional(rows: string[][]): unknown[] {
  const out: unknown[] = [];
  for (const cells of rows) {
    if (cells.length < 5) continue;
    if (looksLikeDate(cells[0])) {
      const hasTime = cells.length >= 6 && looksLikeTime(cells[1]);
      const off = hasTime ? 2 : 1;
      const ts = hasTime ? `${cells[0]} ${cells[1]}`.trim() : cells[0];
      out.push({
        ts,
        o: cells[off],
        h: cells[off + 1],
        l: cells[off + 2],
        c: cells[off + 3],
        v: cells.length > off + 4 ? cells[off + 4] : undefined,
      });
    } else if (isNumeric(cells[0])) {
      out.push({
        ts: cells[0],
        o: cells[1],
        h: cells[2],
        l: cells[3],
        c: cells[4],
        v: cells.length > 5 ? cells[5] : undefined,
      });
    }
  }
  return out;
}

// -------------------------------------------------------------- normalise

function parseTimestamp(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value > MAX_REASONABLE_MS ? Math.floor(value / 1000) : Math.floor(value);
  }
  const s = value.trim();
  if (s === "") return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > MAX_REASONABLE_MS ? Math.floor(n / 1000) : Math.floor(n);
  }
  const m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, y, mo, d, hh = "0", mm = "0", ss = "0"] = m;
    return Math.floor(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)) / 1000);
  }
  const parsed = Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function num(value: number | string | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number.NaN;
}

function makeOHLC(o: number, h: number, l: number, c: number): OHLC {
  if (![o, h, l, c].every(Number.isFinite)) return { o, h, l, c };
  return { o, h: Math.max(o, h, c, l), l: Math.min(o, h, c, l), c };
}

function normaliseBars(rows: unknown[], assumeSpreadPips: number, warnings: string[]): Bar[] {
  const map = new Map<number, Bar>();
  let invertedAsk = 0;
  let skipped = 0;
  let hadAsk = 0;

  for (const raw of rows) {
    const row = raw as RowInput;
    const ts = parseTimestamp(row.ts);
    if (ts == null) {
      skipped++;
      continue;
    }
    const o = num(row.o);
    const h = num(row.h);
    const l = num(row.l);
    const c = num(row.c);
    if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0)) {
      skipped++;
      continue;
    }
    const bid = makeOHLC(o, h, l, c);
    let ask: OHLC;
    const ao = num(row.ao);
    const ah = num(row.ah);
    const al = num(row.al);
    const ac = num(row.ac);
    if ([ao, ah, al, ac].every((x) => Number.isFinite(x) && x > 0)) {
      ask = makeOHLC(ao, ah, al, ac);
      hadAsk++;
      if (ask.o < bid.o || ask.c < bid.c) {
        invertedAsk++;
        const sp = Math.abs(ask.o - bid.o) || Math.abs(ask.c - bid.c) || 0;
        ask = { o: bid.o + sp, h: bid.h + sp, l: bid.l + sp, c: bid.c + sp };
      }
    } else {
      const spread = assumeSpreadPips * 0.0001;
      ask = { o: bid.o + spread, h: bid.h + spread, l: bid.l + spread, c: bid.c + spread };
    }
    const volumeRaw = num(row.v);
    map.set(ts, { ts, bid, ask, volume: Number.isFinite(volumeRaw) && volumeRaw > 0 ? volumeRaw : 0 });
  }

  const bars = [...map.values()].sort((a, b) => a.ts - b.ts);
  if (bars.length < 2) throw new Error("No usable candles found in file");
  if (skipped > 0) warnings.push(`Skipped ${skipped} malformed row(s)`);
  if (invertedAsk > 0) warnings.push(`Corrected ${invertedAsk} row(s) where ask < bid`);
  if (hadAsk === 0) warnings.push("File contains bid prices only — spread set from the 'assume spread' option");
  return bars;
}
