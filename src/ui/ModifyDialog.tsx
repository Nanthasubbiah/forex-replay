import { useState } from "react";
import { useStore } from "../store";
import type { PendingOrder, Position } from "../engine/types";
import { getSymbolSpec } from "../engine/symbols";

export function ModifyDialog({
  ticket,
  kind,
  onClose,
}: {
  ticket: number;
  kind: "position" | "pending";
  onClose: () => void;
}) {
  const sim = useStore((s) => s.sim);
  const loaded = useStore((s) => s.loaded);
  const version = useStore((s) => s.version);
  const modifyPosition = useStore((s) => s.modifyPosition);
  const modifyPending = useStore((s) => s.modifyPending);
  void version;

  const pos: Position | undefined = sim?.positions.find((p) => p.ticket === ticket);
  const order: PendingOrder | undefined = sim?.pendings.find((o) => o.ticket === ticket);
  const target = kind === "position" ? pos : order;
  const spec = loaded ? getSymbolSpec(loaded.symbol) : null;
  const digits = spec?.digits ?? 5;

  const fmt = (v: number | null) => (v == null ? "" : v.toFixed(digits));
  const [price, setPrice] = useState(fmt(order?.price ?? null));
  const [sl, setSl] = useState(fmt(target?.sl ?? null));
  const [tp, setTp] = useState(fmt(target?.tp ?? null));

  if (!target) return null;

  const parse = (s: string): number | null => {
    const t = s.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const save = () => {
    const ok =
      kind === "position"
        ? modifyPosition(ticket, parse(sl), parse(tp))
        : modifyPending(ticket, { price: parse(price), sl: parse(sl), tp: parse(tp) });
    if (ok) onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Modify order">
        <h3>{kind === "position" ? `Modify position #${ticket}` : `Modify pending order #${ticket}`}</h3>
        <div className="modal-fields">
          {kind === "pending" ? (
            <label>
              <span>Trigger price</span>
              <input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
          ) : null}
          <label>
            <span>Stop loss (price)</span>
            <input type="number" step="any" value={sl} placeholder="none" onChange={(e) => setSl(e.target.value)} />
          </label>
          <label>
            <span>Take profit (price)</span>
            <input type="number" step="any" value={tp} placeholder="none" onChange={(e) => setTp(e.target.value)} />
          </label>
          <p className="modal-note">Leave a field empty to remove it. Enter prices with {digits} decimals.</p>
        </div>
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
