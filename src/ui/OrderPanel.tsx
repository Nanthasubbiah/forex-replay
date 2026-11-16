import { useState } from "react";
import { useStore } from "../store";
import type { PendingType } from "../engine/types";
import { getSymbolSpec } from "../engine/symbols";
import { fmtPrice } from "../lib/format";

const PENDING_TYPES: { value: PendingType; label: string }[] = [
  { value: "buy_limit", label: "Buy Limit" },
  { value: "sell_limit", label: "Sell Limit" },
  { value: "buy_stop", label: "Buy Stop" },
  { value: "sell_stop", label: "Sell Stop" },
];

/** Prices are typed as text so a half-finished number never has to be valid. */
function parsePrice(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function OrderPanel() {
  const sim = useStore((s) => s.sim);
  const loaded = useStore((s) => s.loaded);
  const version = useStore((s) => s.version);
  const buyMarket = useStore((s) => s.buyMarket);
  const placePending = useStore((s) => s.placePending);

  const [lots, setLots] = useState(0.1);
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");

  const [pType, setPType] = useState<PendingType>("buy_limit");
  const [pPrice, setPPrice] = useState("");
  const [pLots, setPLots] = useState(0.1);
  const [pSl, setPSl] = useState("");
  const [pTp, setPTp] = useState("");

  void version;
  const bar = sim?.currentBar() ?? null;
  const spec = loaded ? getSymbolSpec(loaded.symbol) : null;
  const bid = bar ? bar.bid.c : null;
  const ask = bar ? bar.ask.c : null;
  const canTrade = Boolean(bar && spec);

  const submitPending = () => {
    const price = Number(pPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    placePending(pType, pLots, price, parsePrice(pSl), parsePrice(pTp));
    setPPrice("");
  };

  return (
    <section className="panel order-panel">
      <div className="panel-head">
        <h2>New order</h2>
        {spec ? <span className="currency-chip">{spec.code}</span> : null}
      </div>

      <div className="price-strip">
        <span>
          Bid <b>{bid != null && spec ? fmtPrice(bid, spec.digits) : "—"}</b>
        </span>
        <span>
          Ask <b>{ask != null && spec ? fmtPrice(ask, spec.digits) : "—"}</b>
        </span>
      </div>

      <div className="order-form">
        <label>
          <span>Volume (lots)</span>
          <input type="number" min={0.01} step={0.01} value={lots} onChange={(e) => setLots(Number(e.target.value))} />
        </label>
        <div className="two-col">
          <label>
            <span>SL (price)</span>
            <input type="number" step="any" min={0} value={sl} placeholder="none" onChange={(e) => setSl(e.target.value)} />
          </label>
          <label>
            <span>TP (price)</span>
            <input type="number" step="any" min={0} value={tp} placeholder="none" onChange={(e) => setTp(e.target.value)} />
          </label>
        </div>
        <div className="trade-buttons">
          <button className="buy-btn" disabled={!canTrade} onClick={() => buyMarket("buy", lots, parsePrice(sl), parsePrice(tp))}>
            BUY
            {ask != null && spec ? <small>{fmtPrice(ask, spec.digits)}</small> : null}
          </button>
          <button className="sell-btn" disabled={!canTrade} onClick={() => buyMarket("sell", lots, parsePrice(sl), parsePrice(tp))}>
            SELL
            {bid != null && spec ? <small>{fmtPrice(bid, spec.digits)}</small> : null}
          </button>
        </div>
      </div>

      <details className="pending-form" open>
        <summary>Pending order</summary>
        <label>
          <span>Type</span>
          <select value={pType} onChange={(e) => setPType(e.target.value as PendingType)}>
            {PENDING_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <div className="two-col">
          <label>
            <span>Trigger price</span>
            <input
              type="number"
              step="any"
              value={pPrice}
              placeholder={ask != null && spec ? fmtPrice(ask, spec.digits) : "price"}
              onChange={(e) => setPPrice(e.target.value)}
            />
          </label>
          <label>
            <span>Volume</span>
            <input type="number" min={0.01} step={0.01} value={pLots} onChange={(e) => setPLots(Number(e.target.value))} />
          </label>
        </div>
        <div className="two-col">
          <label>
            <span>SL (price)</span>
            <input type="number" step="any" min={0} value={pSl} placeholder="none" onChange={(e) => setPSl(e.target.value)} />
          </label>
          <label>
            <span>TP (price)</span>
            <input type="number" step="any" min={0} value={pTp} placeholder="none" onChange={(e) => setPTp(e.target.value)} />
          </label>
        </div>
        <button className="secondary-btn wide" onClick={submitPending} disabled={!canTrade}>
          Place pending order
        </button>
      </details>
    </section>
  );
}
