import { useMemo } from "react";
import { useDraggable } from "./useDraggable";
import { useCollapsible, CollapseButton } from "./useCollapsible";
import { useAppStore } from "../data/store";
import type { Line, Mode } from "../data/types";

interface Group {
  id: string;
  label: string;
  color: string;
  lineIds: string[];
}

// Curated groups for Stockholm keep the existing labels; otherwise we fall
// back to automatic mode-based groups derived from the active network.
const STOCKHOLM_GROUPS: Group[] = [
  { id: "subway-red",   label: "T-bana röd (T13/T14)",       color: "#ff3d4a", lineIds: ["T13", "T14"] },
  { id: "subway-green", label: "T-bana grön (T17/T18/T19)",  color: "#4bd582", lineIds: ["T17", "T18", "T19"] },
  { id: "subway-blue",  label: "T-bana blå (T10/T11)",       color: "#39a7ff", lineIds: ["T10", "T11"] },
  { id: "rail",         label: "Pendeltåg (J40–J48)",        color: "#ff7a1f", lineIds: ["J40", "J41", "J43", "J43X", "J48"] },
  { id: "tvarbana",     label: "Tvärbanan (L30/L31)",        color: "#b084ff", lineIds: ["L30", "L31"] },
  { id: "roslagsbanan", label: "Roslagsbanan (L27–L29)",     color: "#c266d9", lineIds: ["L27", "L27S", "L28", "L28S", "L28X", "L29"] },
  { id: "saltsjobanan", label: "Saltsjöbanan (L25/L26)",     color: "#ff6fb5", lineIds: ["L25", "L26"] },
  { id: "tram",         label: "Spårvagn (S7/S12/S21)",      color: "#f4c430", lineIds: ["S7", "S12", "S21"] },
  { id: "ferry",        label: "Pendelbåt (B80/B84/B89)",    color: "#24d4d4", lineIds: ["B80", "B80X", "B84", "B89"] },
];

const MODE_INFO: Record<Mode, { label: string; color: string }> = {
  subway:    { label: "Tunnelbana", color: "#39a7ff" },
  rail:      { label: "Pendel/regionaltåg", color: "#ff7a1f" },
  lightrail: { label: "Spårväg & lokalbanor", color: "#b084ff" },
  tram:      { label: "Spårvagn", color: "#f4c430" },
  ferry:     { label: "Pendelbåt", color: "#24d4d4" },
};

function autoGroups(lines: Line[]): Group[] {
  const byMode = new Map<Mode, Line[]>();
  for (const line of lines) {
    const m = (line.mode ?? "subway") as Mode;
    const arr = byMode.get(m) ?? [];
    arr.push(line);
    byMode.set(m, arr);
  }
  const order: Mode[] = ["subway", "rail", "lightrail", "tram", "ferry"];
  const out: Group[] = [];
  for (const m of order) {
    const arr = byMode.get(m);
    if (!arr?.length) continue;
    const info = MODE_INFO[m];
    const ids = arr.map((l) => l.id);
    const preview = ids.slice(0, 4).join(", ") + (ids.length > 4 ? "…" : "");
    out.push({ id: `auto-${m}`, label: `${info.label} (${preview})`, color: info.color, lineIds: ids });
  }
  return out;
}

export function Legend() {
  const drag = useDraggable({ storageKey: "legend", defaultAnchor: { right: 20, bottom: 20 } });
  const { collapsed, toggle } = useCollapsible("legend");
  const hidden = useAppStore((s) => s.hiddenLineIds);
  const hiddenModes = useAppStore((s) => s.hiddenModes);
  const toggleLineGroup = useAppStore((s) => s.toggleLineGroup);
  const toggleMode = useAppStore((s) => s.toggleMode);
  const regionId = useAppStore((s) => s.regionId);
  const network = useAppStore((s) => s.network);

  const groups = useMemo(() => {
    if (regionId === "stockholm") return STOCKHOLM_GROUPS;
    return network ? autoGroups(network.lines) : [];
  }, [regionId, network]);

  const busOn = !hiddenModes.has("bus");
  const showBasemap = useAppStore((s) => s.showBasemap);
  const setShowBasemap = useAppStore((s) => s.setShowBasemap);

  return (
    <div ref={drag.ref as any} className="legend panel" style={drag.style} {...drag.handlers}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h4 style={{ flex: 1, margin: 0 }}>Teckenförklaring</h4>
        <CollapseButton collapsed={collapsed} onToggle={toggle} size={22} />
      </div>
      {!collapsed && <div style={{ height: 10 }} />}
      {!collapsed && groups.map((g) => {
        const isOn = !g.lineIds.every((id) => hidden.has(id));
        return (
          <button
            key={g.id}
            onClick={() => toggleLineGroup(g.lineIds)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "5px 4px",
              width: "100%",
              background: "transparent",
              border: "none",
              color: isOn ? "var(--ink)" : "#5a697f",
              cursor: "pointer",
              fontSize: 12,
              textAlign: "left",
              fontFamily: "inherit",
              borderRadius: 4,
              transition: "color 0.15s",
            }}
          >
            <Toggle on={isOn} color={g.color} />
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: isOn ? g.color : `${g.color}40`,
                boxShadow: isOn ? `0 0 6px ${g.color}` : "none",
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1 }}>{g.label}</span>
          </button>
        );
      })}
      {!collapsed && (
        <>
          <div style={{ height: 8, borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 8 }} />
          <button
            onClick={() => toggleMode("bus")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "5px 4px",
              width: "100%",
              background: "transparent",
              border: "none",
              color: busOn ? "var(--ink)" : "#5a697f",
              cursor: "pointer",
              fontSize: 12,
              textAlign: "left",
              fontFamily: "inherit",
              borderRadius: 4,
            }}
          >
            <Toggle on={busOn} color="#7f88a0" />
            <span style={{ width: 10, height: 10, borderRadius: 2, background: busOn ? "#7f88a0" : "#7f88a040", flexShrink: 0 }} />
            <span style={{ flex: 1 }}>Bussar (alla linjer, som prickar)</span>
          </button>
          <button
            onClick={() => setShowBasemap(!showBasemap)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "5px 4px",
              width: "100%",
              background: "transparent",
              border: "none",
              color: showBasemap ? "var(--ink)" : "#5a697f",
              cursor: "pointer",
              fontSize: 12,
              textAlign: "left",
              fontFamily: "inherit",
              borderRadius: 4,
            }}
          >
            <Toggle on={showBasemap} color="#6ba3d9" />
            <span style={{ width: 10, height: 10, borderRadius: 2, background: showBasemap ? "#6ba3d9" : "#6ba3d940", flexShrink: 0 }} />
            <span style={{ flex: 1 }}>OpenStreetMap-karta (CartoDB Dark)</span>
          </button>
          <BuildingsSettings />
          <div style={{ height: 10 }} />
          <div className="legend-row"><span className="swatch" style={{ background: "#ffffff", color: "#ffffff" }} />I tid</div>
          <div className="legend-row"><span className="swatch" style={{ background: "#ffc04a", color: "#ffc04a" }} />Försenat</div>
          <div className="legend-row"><span className="swatch" style={{ background: "#ff3030", color: "#ff3030" }} />Stillastående</div>
          <div style={{ height: 10 }} />
          <div style={{ fontSize: 10, color: "#8b98ad", letterSpacing: 0.08, textTransform: "uppercase", marginBottom: 4 }}>
            Kronisk försening (senaste ~24h)
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <div style={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              background: "linear-gradient(90deg, #4bd582, #ffc04a, #ff3030)",
              opacity: 0.85,
            }} />
            <span style={{ fontSize: 10, color: "#8b98ad", minWidth: 54, textAlign: "right" }}>sällan → ofta</span>
          </div>
          <div style={{ fontSize: 10.5, color: "#8b98ad", lineHeight: 1.4 }}>
            Klicka i listan för att visa/dölja linjer. Byt region i toppen.
          </div>
        </>
      )}
    </div>
  );
}

function BuildingsSettings() {
  const show = useAppStore((s) => s.showBuildings);
  const opacity = useAppStore((s) => s.buildingsOpacity);
  const height = useAppStore((s) => s.buildingsHeightScale);
  const setShow = useAppStore((s) => s.setShowBuildings);
  const setOpacity = useAppStore((s) => s.setBuildingsOpacity);
  const setHeight = useAppStore((s) => s.setBuildingsHeightScale);

  return (
    <>
      <button
        onClick={() => setShow(!show)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "5px 4px",
          width: "100%",
          background: "transparent",
          border: "none",
          color: show ? "var(--ink)" : "#5a697f",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
          fontFamily: "inherit",
          borderRadius: 4,
          marginTop: 4,
        }}
      >
        <Toggle on={show} color="#8fb3e2" />
        <span style={{ width: 10, height: 10, borderRadius: 2, background: show ? "#8fb3e2" : "#8fb3e240", flexShrink: 0 }} />
        <span style={{ flex: 1 }}>3D-byggnader (OSM)</span>
      </button>
      {show && (
        <div style={{ marginLeft: 24, marginTop: 4, marginBottom: 4, display: "flex", flexDirection: "column", gap: 6 }}>
          <SliderRow
            label="Opacitet"
            value={opacity}
            min={0.1}
            max={1}
            step={0.05}
            onChange={setOpacity}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Höjd"
            value={height}
            min={0.25}
            max={4}
            step={0.25}
            onChange={setHeight}
            format={(v) => `${v.toFixed(2)}×`}
          />
        </div>
      )}
    </>
  );
}

function SliderRow({
  label, value, min, max, step, onChange, format,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 10, color: "#8b98ad", width: 54, flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: "#8fb3e2" }}
      />
      <span style={{ fontSize: 10, color: "#c7cfdc", minWidth: 40, textAlign: "right", fontFamily: "JetBrains Mono, monospace" }}>
        {format(value)}
      </span>
    </div>
  );
}

function Toggle({ on, color }: { on: boolean; color: string }) {
  return (
    <span
      style={{
        width: 26,
        height: 14,
        borderRadius: 7,
        background: on ? color : "rgba(255,255,255,0.14)",
        position: "relative",
        transition: "background 0.18s",
        flexShrink: 0,
        boxShadow: on ? `0 0 8px ${color}70` : "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 14 : 2,
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.18s",
          boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
        }}
      />
    </span>
  );
}
