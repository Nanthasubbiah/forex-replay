import { useEffect, useRef } from "react";

export interface MenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

/** Fixed-position right-click menu, clamped to the viewport. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(x, window.innerWidth - 190));
  const top = Math.max(8, Math.min(y, window.innerHeight - items.length * 34 - 14));

  return (
    <div ref={ref} className="ctx-menu" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) => (
        <button
          key={i}
          className={`ctx-item ${item.danger ? "danger" : ""}`}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
