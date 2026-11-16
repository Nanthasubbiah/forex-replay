import { useEffect, useState } from "react";
import { useStore, type AccountSettings } from "../store";
import { fmtMoney, fmtPct } from "../lib/format";

export function AccountPanel() {
  const sim = useStore((s) => s.sim);
  const version = useStore((s) => s.version);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const reset = useStore((s) => s.reset);
  const loaded = useStore((s) => s.loaded);

  const [draft, setDraft] = useState<AccountSettings>(settings);
  useEffect(() => setDraft(settings), [settings]);

  const snap = sim?.snapshot() ?? null;
  const level = snap ? snap.marginLevel : Infinity;
  void version;

  const commit = () => {
    updateSettings({
      initialBalance: Math.max(100, Number(draft.initialBalance) || 10_000),
      leverage: Math.max(1, Math.round(Number(draft.leverage) || 100)),
      stopOutLevel: Math.max(1, Number(draft.stopOutLevel) || 50),
      commissionPerLot: Math.max(0, Number(draft.commissionPerLot) || 0),
      assumeSpreadPips: Math.max(0, Number(draft.assumeSpreadPips) || 0),
    });
  };

  return (
    <section className="panel account-panel">
      <div className="panel-head">
        <h2>Account</h2>
        <span className="currency-chip">USD</span>
      </div>
      <div className="account-rows">
        <div className="row">
          <span>Balance</span>
          <b>{fmtMoney(snap?.balance ?? settings.initialBalance)}</b>
        </div>
        <div className="row">
          <span>Equity</span>
          <b className={snap && snap.equity < snap.balance ? "neg" : ""}>{fmtMoney(snap?.equity ?? settings.initialBalance)}</b>
        </div>
        <div className="row">
          <span>Margin</span>
          <b>{fmtMoney(snap?.margin ?? 0)}</b>
        </div>
        <div className="row">
          <span>Free margin</span>
          <b>{fmtMoney(snap?.freeMargin ?? settings.initialBalance)}</b>
        </div>
        <div className="row">
          <span>Margin level</span>
          <b>{Number.isFinite(level) ? fmtPct(level) : "—"}</b>
        </div>
        <div className="row">
          <span>Open P/L</span>
          <b className={snap && snap.floatingPnl < 0 ? "neg" : "pos"}>
            {fmtMoney(snap?.floatingPnl ?? 0)}
          </b>
        </div>
      </div>

      <details className="settings">
        <summary>Account settings</summary>
        <div className="settings-grid">
          <label>
            <span>Balance</span>
            <input type="number" value={draft.initialBalance} onChange={(e) => setDraft({ ...draft, initialBalance: Number(e.target.value) })} />
          </label>
          <label>
            <span>Leverage 1:</span>
            <input type="number" value={draft.leverage} onChange={(e) => setDraft({ ...draft, leverage: Number(e.target.value) })} />
          </label>
          <label>
            <span>Stop-out %</span>
            <input type="number" value={draft.stopOutLevel} onChange={(e) => setDraft({ ...draft, stopOutLevel: Number(e.target.value) })} />
          </label>
          <label>
            <span>Comm./lot</span>
            <input type="number" value={draft.commissionPerLot} onChange={(e) => setDraft({ ...draft, commissionPerLot: Number(e.target.value) })} />
          </label>
          <label>
            <span>Bid-only spread (pips)</span>
            <input type="number" value={draft.assumeSpreadPips} onChange={(e) => setDraft({ ...draft, assumeSpreadPips: Number(e.target.value) })} />
          </label>
        </div>
        <div className="settings-actions">
          <button className="secondary-btn" onClick={reset} disabled={!loaded}>
            Reset replay
          </button>
          <button className="primary-btn" onClick={commit}>
            Apply & reset
          </button>
        </div>
      </details>
    </section>
  );
}
