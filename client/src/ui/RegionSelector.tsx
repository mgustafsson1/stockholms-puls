import { useAppStore } from "../data/store";

export function RegionSelector() {
  const regions = useAppStore((s) => s.regions);
  const regionId = useAppStore((s) => s.regionId);
  const setRegionId = useAppStore((s) => s.setRegionId);

  if (regions.length < 2) return null;

  return (
    <div
      className="panel"
      style={{
        position: "fixed",
        top: 20,
        left: "calc(50% + 200px)",
        zIndex: 11,
        padding: "4px 6px",
        display: "flex",
        gap: 4,
        pointerEvents: "auto",
      }}
    >
      {regions.map((r) => {
        const active = r.id === regionId;
        return (
          <button
            key={r.id}
            onClick={() => setRegionId(r.id)}
            style={{
              background: active ? "rgba(124,196,255,0.18)" : "transparent",
              border: `1px solid ${active ? "rgba(124,196,255,0.45)" : "rgba(255,255,255,0.08)"}`,
              color: active ? "#fff" : "#c7cfdc",
              padding: "5px 10px",
              fontSize: 11,
              letterSpacing: 0.04,
              fontWeight: active ? 600 : 400,
              borderRadius: 6,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >{r.label}</button>
        );
      })}
    </div>
  );
}
