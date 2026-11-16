import { useStore } from "../store";
import { fmtTime } from "../lib/format";

export function ReplayBar() {
  const loaded = useStore((s) => s.loaded);
  const pos = useStore((s) => s.pos);
  const running = useStore((s) => s.running);
  const speed = useStore((s) => s.speed);
  const strategyKind = useStore((s) => s.strategyKind);
  const play = useStore((s) => s.play);
  const pause = useStore((s) => s.pause);
  const step = useStore((s) => s.step);
  const reset = useStore((s) => s.reset);
  const setSpeed = useStore((s) => s.setSpeed);
  const backtestToEnd = useStore((s) => s.backtestToEnd);
  const setStrategy = useStore((s) => s.setStrategy);

  const total = loaded?.bars.length ?? 0;
  const pct = total > 0 ? (pos / total) * 100 : 0;
  const lastTs = loaded && pos > 0 ? loaded.bars[pos - 1].ts : null;

  return (
    <div className="replaybar">
      <div className="replay-controls">
        <button className="icon-btn" onClick={reset} disabled={!loaded} title="Reset replay">
          ⟲
        </button>
        <button className="icon-btn" onClick={step} disabled={!loaded || running} title="Step one bar">
          ⏭
        </button>
        <button className="icon-btn play-btn" onClick={() => (running ? pause() : play())} disabled={!loaded} title={running ? "Pause" : "Play"}>
          {running ? "⏸" : "▶"}
        </button>
        <select
          className="speed-select"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          title="Replay speed"
        >
          {[1, 4, 10, 25, 100, 400].map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
      </div>

      <div className="replay-progress">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="progress-label">
          {pos.toLocaleString()} / {total.toLocaleString()} bars
          {lastTs != null ? ` · ${fmtTime(lastTs)} UTC` : ""}
        </span>
      </div>

      <div className="replay-strategy">
        <label className="field-inline">
          <span>Strategy</span>
          <select value={strategyKind ?? "none"} onChange={(e) => setStrategy(e.target.value === "sma" ? "sma" : null)} disabled={!loaded}>
            <option value="none">Manual</option>
            <option value="sma">SMA 20/50</option>
          </select>
        </label>
        <button className="secondary-btn" onClick={backtestToEnd} disabled={!loaded || pos >= total}>
          Backtest ▸
        </button>
      </div>
    </div>
  );
}
