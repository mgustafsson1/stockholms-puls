import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../data/store";

export function RegionSelector() {
  const regions = useAppStore((s) => s.regions);
  const regionId = useAppStore((s) => s.regionId);
  const setRegionId = useAppStore((s) => s.setRegionId);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the menu if the user clicks away or hits Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (regions.length < 2) return null;

  const current = regions.find((r) => r.id === regionId);

  return (
    <div
      ref={rootRef}
      style={{
        position: "fixed",
        top: 20,
        left: "calc(50% + 200px)",
        zIndex: 11,
        pointerEvents: "auto",
      }}
    >
      <button
        className="panel"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 14px",
          fontSize: 12,
          letterSpacing: 0.04,
          color: "#fff",
          fontWeight: 600,
          borderRadius: 8,
          cursor: "pointer",
          fontFamily: "inherit",
          background: "rgba(10,15,28,0.82)",
          border: "1px solid rgba(124,196,255,0.35)",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ fontSize: 9, letterSpacing: 0.18, textTransform: "uppercase", color: "#8b98ad" }}>
          Region
        </span>
        <span>{current?.label ?? regionId}</span>
        <span style={{ color: "#8b98ad", fontSize: 10 }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div
          className="panel"
          role="listbox"
          style={{
            marginTop: 6,
            padding: 4,
            minWidth: 200,
            maxHeight: 360,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {regions.map((r) => {
            const active = r.id === regionId;
            return (
              <button
                key={r.id}
                role="option"
                aria-selected={active}
                onClick={() => {
                  setRegionId(r.id);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 6,
                  background: active ? "rgba(124,196,255,0.18)" : "transparent",
                  color: active ? "#fff" : "#c7cfdc",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 13,
                  fontFamily: "inherit",
                  fontWeight: active ? 600 : 400,
                }}
              >
                <span
                  style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: active ? "#7cc4ff" : "transparent",
                    border: active ? "none" : "1px solid rgba(255,255,255,0.2)",
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1 }}>{r.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
