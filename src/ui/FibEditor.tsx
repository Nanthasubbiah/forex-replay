import { useState } from "react";
import {
  addLevel,
  FIB_COLOR_PRESETS,
  fibPrice,
  ratioLabel,
  removeLevel,
  toggleLevel,
  type FibDrawing,
} from "../lib/fib";

export function FibEditor({
  fib,
  digits,
  onChange,
  onClose,
  onRemove,
}: {
  fib: FibDrawing;
  digits: number;
  onChange: (updated: FibDrawing) => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  const [addPct, setAddPct] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const add = () => {
    const next = addLevel(fib.levels, Number(addPct));
    if (!next) {
      setAddError("Enter a valid, non-duplicate level (0 < level ≤ 1000%).");
      return;
    }
    onChange({ ...fib, levels: next });
    setAddPct("");
    setAddError(null);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal fib-editor" role="dialog" aria-label="Fibonacci levels">
        <h3>Fibonacci levels</h3>

        <div className="fib-color-row">
          <span className="fib-label">Colour</span>
          <input
            type="color"
            value={fib.color}
            onChange={(e) => onChange({ ...fib, color: e.target.value })}
            aria-label="Fibonacci colour"
          />
          <div className="fib-swatches">
            {FIB_COLOR_PRESETS.map((c) => (
              <button
                key={c}
                className={`fib-swatch ${fib.color === c ? "active" : ""}`}
                style={{ background: c }}
                onClick={() => onChange({ ...fib, color: c })}
                aria-label={`Use colour ${c}`}
              />
            ))}
          </div>
        </div>

        <div className="fib-levels">
          {fib.levels.map((lvl) => (
            <div className="fib-row" key={lvl.ratio}>
              <label className="fib-check">
                <input
                  type="checkbox"
                  checked={lvl.enabled}
                  onChange={() => onChange({ ...fib, levels: toggleLevel(fib.levels, lvl.ratio) })}
                />
                <span>{ratioLabel(lvl.ratio)}</span>
              </label>
              <span className="fib-price">{fibPrice(fib.a.price, fib.b.price, lvl.ratio).toFixed(digits)}</span>
              <button
                className="link-btn"
                onClick={() => onChange({ ...fib, levels: removeLevel(fib.levels, lvl.ratio) })}
              >
                remove
              </button>
            </div>
          ))}
        </div>

        <div className="fib-add">
          <input
            type="number"
            step="any"
            placeholder="Add level, e.g. 127.2"
            value={addPct}
            onChange={(e) => {
              setAddPct(e.target.value);
              setAddError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="secondary-btn small" onClick={add}>
            Add
          </button>
        </div>
        {addError ? <p className="fib-error">{addError}</p> : null}

        <p className="modal-note">Drag the diagonal on the chart to move the whole tool.</p>

        <div className="modal-actions">
          <button
            className="secondary-btn danger"
            onClick={() => {
              onRemove();
              onClose();
            }}
          >
            Remove tool
          </button>
          <button className="primary-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
