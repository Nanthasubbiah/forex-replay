import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { FibToolKind } from "../lib/fib";

export function ChartToolbar() {
  const loaded = useStore((s) => s.loaded);
  const pos = useStore((s) => s.pos);
  const fibs = useStore((s) => s.fibs);
  const fibTool = useStore((s) => s.fibTool);
  const fibAnchor = useStore((s) => s.fibAnchor);
  const setFibTool = useStore((s) => s.setFibTool);
  const clearFibs = useStore((s) => s.clearFibs);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && e.target instanceof Node && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = fibTool !== null;

  const choose = (kind: FibToolKind) => {
    setFibTool(kind);
    setOpen(false);
  };

  return (
    <div className="toolbar">
      <div className="tb-group" ref={wrapRef}>
        <button
          className={`toolbar-tab ${active ? "active" : ""}`}
          disabled={!loaded || pos === 0}
          onClick={() => {
            if (active) {
              setFibTool(null);
              return;
            }
            setOpen((o) => !o);
          }}
          title="Fibonacci drawing tools — choose Retracement or Extension"
        >
          Fibonacci <span className="tb-caret">▾</span>
        </button>
        {open ? (
          <div className="toolbar-menu" role="menu">
            <button className={`toolbar-item ${fibTool === "retracement" ? "active" : ""}`} role="menuitem" onClick={() => choose("retracement")}>
              <b>Retracement</b>
              <small>0% → 100% levels between two swing points</small>
            </button>
            <button className={`toolbar-item ${fibTool === "extension" ? "active" : ""}`} role="menuitem" onClick={() => choose("extension")}>
              <b>Extension</b>
              <small>Retracement plus 127.2% and 161.8% projections</small>
            </button>
          </div>
        ) : null}
      </div>
      <button className="toolbar-tab" onClick={clearFibs} disabled={fibs.length === 0} title="Remove all drawings">
        Clear
      </button>
      {fibs.length > 0 ? <span className="tool-chip">{fibs.length} fib</span> : null}
      <span className="tb-spacer" />
      {active ? <span className="tool-hint">{fibAnchor ? "click swing point 2" : "click swing point 1"}</span> : null}
      <span className="tb-help">Right-click a level to toggle it · drag an anchor to resize · drag the diagonal to move</span>
    </div>
  );
}
