import { useDraggable } from "./useDraggable";
import { useCollapsible, CollapseButton } from "./useCollapsible";
import { useAppStore } from "../data/store";

interface Group {
  id: string;
  label: string;
  color: string;
  lineIds: string[];
}

const GROUPS: Group[] = [
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

export function Legend() {
  const drag = useDraggable({ storageKey: "legend", defaultAnchor: { right: 20, bottom: 20 } });
  const { collapsed, toggle } = useCollapsible("legend");
  const hidden = useAppStore((s) => s.hiddenLineIds);
  const toggleLineGroup = useAppStore((s) => s.toggleLineGroup);

  return (
    <div ref={drag.ref as any} className="legend panel" style={drag.style} {...drag.handlers}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h4 style={{ flex: 1, margin: 0 }}>Teckenförklaring</h4>
        <CollapseButton collapsed={collapsed} onToggle={toggle} size={22} />
      </div>
      {!collapsed && <div style={{ height: 10 }} />}
      {!collapsed && GROUPS.map((g) => {
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
          <div style={{ height: 10 }} />
          <div className="legend-row"><span className="swatch" style={{ background: "#ffffff", color: "#ffffff" }} />I tid</div>
          <div className="legend-row"><span className="swatch" style={{ background: "#ffc04a", color: "#ffc04a" }} />Försenat</div>
          <div className="legend-row"><span className="swatch" style={{ background: "#ff3030", color: "#ff3030" }} />Stillastående</div>
          <div style={{ height: 10 }} />
          <div style={{ fontSize: 10.5, color: "#8b98ad", lineHeight: 1.4 }}>
            Klicka i listan för att visa/dölja linjer. T-bana under mark, övriga på marknivå. Horisontell skala 1:300.
          </div>
        </>
      )}
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
