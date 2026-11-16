export function fmtMoney(n: number, currency = "USD", digits = 2): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${sign}${currency === "USD" ? "$" : ""}${s}${currency === "USD" ? "" : " " + currency}`;
}

export function fmtSigned(n: number, digits = 2): string {
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? "-" : "+"}${s}`;
}

export function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "∞";
  return `${n.toFixed(digits)}%`;
}

export function fmtPrice(n: number, digits: number): string {
  return n.toFixed(digits);
}

export function fmtTime(ts: number | null): string {
  if (ts == null) return "—";
  const d = new Date(ts * 1000);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function fmtDay(ts: number | null): string {
  if (ts == null) return "—";
  const d = new Date(ts * 1000);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fmtLots(n: number): string {
  return n.toFixed(2);
}
