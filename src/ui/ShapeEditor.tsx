import { SHAPE_COLOR_PRESETS, SHAPE_LABEL, type DrawingShape } from "../lib/shapes";

export function ShapeEditor({
  shape,
  onChange,
  onClose,
  onRemove,
}: {
  shape: DrawingShape;
  onChange: (updated: DrawingShape) => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal fib-editor" role="dialog" aria-label="Line settings">
        <h3>{SHAPE_LABEL[shape.kind]} · colour</h3>

        <div className="fib-color-row">
          <span className="fib-label">Colour</span>
          <input
            type="color"
            value={shape.color}
            onChange={(e) => onChange({ ...shape, color: e.target.value })}
            aria-label="Line colour"
          />
          <div className="fib-swatches">
            {SHAPE_COLOR_PRESETS.map((color) => (
              <button
                key={color}
                className={`fib-swatch ${shape.color === color ? "active" : ""}`}
                style={{ background: color }}
                onClick={() => onChange({ ...shape, color })}
                aria-label={`Use colour ${color}`}
              />
            ))}
          </div>
        </div>

        <p className="modal-note">
          Drag the line on the chart to pan it.{" "}
          {shape.kind === "trend"
            ? "Drag either end point to re-aim it — the line runs on past the second point to the right edge of the chart."
            : ""}
        </p>

        <div className="modal-actions">
          <button className="secondary-btn danger" onClick={onRemove}>
            Remove line
          </button>
          <button className="primary-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
