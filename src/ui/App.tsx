import { useEffect } from "react";
import { useStore } from "../store";
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
