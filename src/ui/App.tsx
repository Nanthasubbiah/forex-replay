import { useEffect, useState } from "react";
import { useStore } from "../store";
import { SYMBOL_CODES, SYMBOL_SPECS } from "../engine/symbols";
import { Chart } from "./Chart";
import { ChartToolbar } from "./ChartToolbar";
import { AccountPanel } from "./AccountPanel";
import { OrderPanel } from "./OrderPanel";
import { ReplayBar } from "./ReplayBar";
import { BottomTabs } from "./BottomTabs";

export default function App() {
  const loaded = useStore((s) => s.loaded);
  const loadDemo = useStore((s) => s.loadDemo);
  const loadFile = useStore((s) => s.loadFile);
  const symbol = useStore((s) => s.symbol);
  const setSymbol = useStore((s) => s.setSymbol);

  // Editable copy of the symbol so typing does not reload anything until Enter/blur.
  const [draft, setDraft] = useState(symbol);
  useEffect(() => setDraft(symbol), [symbol]);

  const commitSymbol = () => {
    const next = draft.trim().toUpperCase();
    if (next === symbol) {
      setDraft(symbol);
      return;
    }
    if (!setSymbol(next)) setDraft(symbol);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void loadFile(file);
    e.target.value = "";
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">▚</span>
          <span className="brand-name">ForexReplay</span>
          <span className="brand-tag">MT4-style backtesting desk</span>
        </div>
        <div className="topbar-right">
          <span className={`data-chip ${loaded ? "has-data" : ""}`}>
            {loaded ? loaded.sourceName : "no data loaded"}
          </span>
          <label className="symbol-field" title="Symbol code for this replay — type it (e.g. GBPUSD) and press Enter">
            <span>Symbol</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.toUpperCase())}
              onBlur={commitSymbol}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setDraft(symbol);
                  e.currentTarget.blur();
                }
              }}
              list="symbol-codes"
              spellCheck={false}
              autoComplete="off"
              aria-label="Replay symbol"
            />
            <datalist id="symbol-codes">
              {SYMBOL_CODES.map((code) => (
                <option key={code} value={code}>
                  {SYMBOL_SPECS[code].description}
                </option>
              ))}
            </datalist>
          </label>
          <button className="secondary-btn" onClick={loadDemo}>
            Demo data
          </button>
          <label className="primary-btn file-btn">
            Load data
            <input
              type="file"
              accept=".csv,.json,.gz,.zip,text/csv,application/json,application/gzip"
              onChange={onFile}
              hidden
            />
          </label>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <AccountPanel />
          <OrderPanel />
        </aside>
        <main className="maincol">
          <ChartToolbar />
          <Chart />
          <ReplayBar />
          <BottomTabs />
        </main>
      </div>

      <Toast />
    </div>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  const setToast = useStore((s) => s.setToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} onClick={() => setToast(null)} role="status">
      {toast.message}
    </div>
  );
}
