import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { FibToolKind } from "../lib/fib";
import {
  INDICATOR_KINDS,
  indicatorDef,
  indicatorOutputs,
  indicatorTitle,
} from "../lib/indicatorRegistry";
import { SHAPE_LABEL, type ShapeToolKind } from "../lib/shapes";

type MenuKey = "fib" | "shapes" | "indicators";

const SHAPE_HINTS: Record<ShapeToolKind, string> = {
  vertical: "click to place a vertical line",
  horizontal: "click to place a horizontal line",
  trend: "click trend point 1",
};

export function ChartToolbar() {
  const loaded = useStore((s) => s.loaded);
  const pos = useStore((s) => s.pos);
  const fibs = useStore((s) => s.fibs);
  const fibTool = useStore((s) => s.fibTool);
  const fibAnchor = useStore((s) => s.fibAnchor);
  const setFibTool = useStore((s) => s.setFibTool);
  const clearDrawings = useStore((s) => s.clearDrawings);

  const shapes = useStore((s) => s.shapes);
  const shapeTool = useStore((s) => s.shapeTool);
  const shapeAnchor = useStore((s) => s.shapeAnchor);
  const setShapeTool = useStore((s) => s.setShapeTool);

  const indicators = useStore((s) => s.indicators);
  const addIndicator = useStore((s) => s.addIndicator);
  const openIndicatorEditor = useStore((s) => s.openIndicatorEditor);
  const clearIndicators = useStore((s) => s.clearIndicators);

  const crosshair = useStore((s) => s.crosshair);
  const setCrosshair = useStore((s) => s.setCrosshair);
  const showVolume = useStore((s) => s.showVolume);
  const setShowVolume = useStore((s) => s.setShowVolume);

  const [open, setOpen] = useState<MenuKey | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && e.target instanceof Node && !wrapRef.current.contains(e.target)) setOpen(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (key: MenuKey) => setOpen((current) => (current === key ? null : key));

  const drawingCount = fibs.length + shapes.length;
  const chips: string[] = [];
  if (fibs.length > 0) chips.push(`${fibs.length} fib`);
  if (shapes.length > 0) chips.push(`${shapes.length} line${shapes.length === 1 ? "" : "s"}`);
  if (indicators.length > 0) chips.push(`${indicators.length} indicator${indicators.length === 1 ? "" : "s"}`);

  const hint =
    fibTool != null
      ? fibAnchor
        ? "click swing point 2"
        : "click swing point 1"
      : shapeTool != null
        ? shapeTool === "trend" && shapeAnchor != null
          ? "click trend point 2"
          : SHAPE_HINTS[shapeTool]
        : crosshair
          ? "crosshair on — click two points to measure"
          : null;

  const chooseFib = (kind: FibToolKind) => {
    setFibTool(kind);
    setOpen(null);
  };

  const chooseShape = (kind: ShapeToolKind) => {
    setShapeTool(kind);
    setOpen(null);
  };

  return (
    <div className="toolbar" ref={wrapRef}>
      <div className="tb-group">
        <button
          className={`toolbar-tab ${fibTool != null ? "active" : ""}`}
          disabled={!loaded || pos === 0}
          onClick={() => {
            if (fibTool != null) {
              setFibTool(null);
              setOpen(null);
              return;
            }
            toggle("fib");
          }}
          title="Fibonacci drawing tools — choose Retracement or Extension"
        >
          Fibonacci <span className="tb-caret">▾</span>
        </button>
        {open === "fib" ? (
          <div className="toolbar-menu" role="menu">
            <button className={`toolbar-item ${fibTool === "retracement" ? "active" : ""}`} role="menuitem" onClick={() => chooseFib("retracement")}>
              <b>Retracement</b>
              <small>0% → 100% levels between two swing points</small>
            </button>
            <button className={`toolbar-item ${fibTool === "extension" ? "active" : ""}`} role="menuitem" onClick={() => chooseFib("extension")}>
              <b>Extension</b>
              <small>Retracement plus 127.2% and 161.8% projections</small>
            </button>
          </div>
        ) : null}
      </div>

      <div className="tb-group">
        <button
          className={`toolbar-tab ${shapeTool != null ? "active" : ""}`}
          disabled={!loaded || pos === 0}
          onClick={() => {
            if (shapeTool != null) {
              setShapeTool(null);
              setOpen(null);
              return;
            }
            toggle("shapes");
          }}
          title="Line tools — vertical, horizontal and trend lines"
        >
          Shapes <span className="tb-caret">▾</span>
        </button>
        {open === "shapes" ? (
          <div className="toolbar-menu" role="menu">
            {(["vertical", "horizontal", "trend"] as ShapeToolKind[]).map((kind) => (
              <button
                key={kind}
                className={`toolbar-item ${shapeTool === kind ? "active" : ""}`}
                role="menuitem"
                onClick={() => chooseShape(kind)}
              >
                <b>{SHAPE_LABEL[kind]}</b>
                <small>{kind === "trend" ? "Two clicks — join two points, then it runs on to the right edge" : "One click — drag the line to pan it"}</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="tb-group">
        <button
          className="toolbar-tab"
          disabled={!loaded}
          onClick={() => toggle("indicators")}
          title="Technical indicators"
        >
          Indicators <span className="tb-caret">▾</span>
        </button>
        {open === "indicators" ? (
          <div className="toolbar-menu" role="menu">
            <div className="toolbar-section">Add</div>
            {INDICATOR_KINDS.map((kind) => {
              const def = indicatorDef(kind);
              return (
                <button
                  key={kind}
                  className="toolbar-item"
                  role="menuitem"
                  onClick={() => {
                    addIndicator(kind);
                    setOpen(null);
                  }}
                >
                  <b>{def.label}</b>
                  <small>{def.description}</small>
                </button>
              );
            })}
            {indicators.length > 0 ? (
              <>
                <div className="toolbar-section">On chart</div>
                {indicators.map((inst) => {
                  const def = indicatorDef(inst.kind);
                  const main = indicatorOutputs(inst)[0];
                  return (
                    <button
                      key={inst.id}
                      className="toolbar-item"
                      role="menuitem"
                      onClick={() => {
                        openIndicatorEditor(inst.id);
                        setOpen(null);
                      }}
                    >
                      <b>
                        <span className="ma-dot" style={{ background: main?.color ?? "#e5e7eb" }} />
                        {indicatorTitle(inst)}
                      </b>
                      <small>
                        {def.placement === "pane" ? "separate pane" : "on price"} · click to edit
                      </small>
                    </button>
                  );
                })}
                <button
                  className="toolbar-item danger-item"
                  role="menuitem"
                  onClick={() => {
                    clearIndicators();
                    setOpen(null);
                  }}
                >
                  <b>Remove all indicators</b>
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <button
        className={`toolbar-tab ${crosshair ? "active" : ""}`}
        onClick={() => {
          setCrosshair(!crosshair);
          setOpen(null);
        }}
        disabled={!loaded || pos === 0}
        aria-pressed={crosshair}
        title="MT4-style crosshair ruler — click two points to read the bar count, elapsed time and pip/point distance between them (Esc clears)"
      >
        Crosshair
      </button>

      <button
        className={`toolbar-tab ${showVolume ? "active" : ""}`}
        onClick={() => setShowVolume(!showVolume)}
        disabled={!loaded || pos === 0}
        aria-pressed={showVolume}
        title="Show/hide the volume histogram under the candles"
      >
        Volumes
      </button>

      <button
        className="toolbar-tab"
        onClick={() => {
          clearDrawings();
          setOpen(null);
        }}
        disabled={drawingCount === 0}
        title="Remove all drawings (Fibonacci and lines)"
      >
        Clear
      </button>
      {chips.length > 0 ? <span className="tool-chip">{chips.join(" · ")}</span> : null}
      <span className="tb-spacer" />
      {hint ? <span className="tool-hint">{hint}</span> : null}
      <span className="tb-help">drag any drawing to pan · right-click for options · click an indicator to edit</span>
    </div>
  );
}
