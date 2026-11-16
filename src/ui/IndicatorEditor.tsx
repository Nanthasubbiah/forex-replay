import { useState } from "react";
import {
  INDICATOR_COLOR_PRESETS,
  indicatorDef,
  indicatorTitle,
  type IndicatorColorSpec,
  type IndicatorInstance,
  type IndicatorParamSpec,
} from "../lib/indicatorRegistry";

function clampParam(spec: IndicatorParamSpec, raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  let value = raw;
  if (spec.integer) value = Math.round(value);
  if (spec.min != null && value < spec.min) value = spec.min;
  if (spec.max != null && value > spec.max) value = spec.max;
  return value;
}

export function IndicatorEditor({
  instance,
  onChange,
  onClose,
  onRemove,
}: {
  instance: IndicatorInstance;
  onChange: (updated: IndicatorInstance) => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  const def = indicatorDef(instance.kind);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const params = instance.params;
  const colors = instance.colors;

  const setParam = (key: string, value: number) => {
    onChange({ ...instance, params: { ...params, [key]: value } });
  };

  const visibleParams = def.params.filter((spec) => spec.visible?.(params) !== false);
  const visibleColors = def.colors.filter((spec) => spec.visible?.(params) !== false);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ma-editor" role="dialog" aria-label={`${def.label} settings`}>
        <h3>
          {def.label} · {indicatorTitle(instance)}
        </h3>
        <p className="modal-note">{def.description}</p>

        <div className="modal-fields">
          {visibleParams.map((spec) =>
            spec.options ? (
              <label key={spec.key}>
                <span>{spec.label}</span>
                <select value={params[spec.key]} onChange={(e) => setParam(spec.key, Number(e.target.value))}>
                  {spec.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : spec.boolean ? (
              <label key={spec.key} className="ma-toggle">
                <input
                  type="checkbox"
                  checked={(params[spec.key] ?? 0) > 0.5}
                  onChange={(e) => setParam(spec.key, e.target.checked ? 1 : 0)}
                />
                <span>{spec.label}</span>
              </label>
            ) : (
              <label key={spec.key}>
                <span>{spec.label}</span>
                <input
                  type="number"
                  min={spec.min ?? 0}
                  max={spec.max}
                  step={spec.step ?? 1}
                  value={draft[spec.key] ?? String(params[spec.key])}
                  onChange={(e) => {
                    const text = e.target.value;
                    setDraft((prev) => ({ ...prev, [spec.key]: text }));
                    if (text.trim() === "") return;
                    const next = clampParam(spec, Number(text));
                    if (next != null) setParam(spec.key, next);
                  }}
                  onBlur={() =>
                    setDraft((prev) => {
                      const { [spec.key]: _omit, ...rest } = prev;
                      return rest;
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
              </label>
            ),
          )}

          {visibleColors.map((spec: IndicatorColorSpec) => (
            <ColorRow
              key={spec.key}
              label={spec.label}
              value={colors[spec.key]}
              onChange={(color) => onChange({ ...instance, colors: { ...colors, [spec.key]: color } })}
            />
          ))}
        </div>

        <p className="modal-note">
          The line appears once the replay has enough bars; click an indicator in the toolbar list to reopen this
          window.
        </p>

        <div className="modal-actions">
          <button className="secondary-btn danger" onClick={onRemove}>
            Remove indicator
          </button>
          <button className="primary-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="fib-color-row">
      <span className="fib-label">{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} colour`} />
      <div className="fib-swatches">
        {INDICATOR_COLOR_PRESETS.map((color) => (
          <button
            key={color}
            className={`fib-swatch ${value === color ? "active" : ""}`}
            style={{ background: color }}
            onClick={() => onChange(color)}
            aria-label={`Use colour ${color}`}
          />
        ))}
      </div>
    </div>
  );
}
