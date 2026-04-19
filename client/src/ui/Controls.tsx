import { useAppStore } from "../data/store";
import type { CameraMode } from "../data/types";
import { useDraggable } from "./useDraggable";
import { useCollapsible, CollapseButton } from "./useCollapsible";

const MODES: { id: CameraMode; label: string; desc: string }[] = [
  { id: "overview", label: "Översikt", desc: "Fritt 3D-perspektiv" },
  { id: "cross-section", label: "Bergsnitt", desc: "Från sidan — visar djup" },
  { id: "follow", label: "Följ tåg", desc: "Klicka ett tåg i vyn" },
  { id: "anomaly", label: "Hitta avvikelser", desc: "Zooma till förseningar" },
];

export function Controls() {
  const mode = useAppStore((s) => s.cameraMode);
  const setMode = useAppStore((s) => s.setCameraMode);
  const followId = useAppStore((s) => s.followTrainId);
  const drag = useDraggable({ storageKey: "controls", defaultAnchor: { left: 20, bottom: 20 } });
  const { collapsed, toggle } = useCollapsible("controls");

  return (
    <div ref={drag.ref as any} className="controls panel" style={drag.style} {...drag.handlers}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div className="label" style={{ flex: 1, marginBottom: 0 }}>Kameraläge</div>
        <CollapseButton collapsed={collapsed} onToggle={toggle} size={22} />
      </div>
      {!collapsed && MODES.map((m) => {
        const disabled = m.id === "follow" && !followId;
        return (
          <button
            key={m.id}
            className={mode === m.id ? "active" : ""}
            onClick={() => {
              if (m.id === "follow" && !followId) return;
              setMode(m.id);
            }}
            title={m.desc}
            style={disabled ? { opacity: 0.5, cursor: "default" } : undefined}
          >
            {m.label}
            <div style={{ fontSize: 10.5, color: "#8b98ad", marginTop: 2 }}>{m.desc}</div>
          </button>
        );
      })}
    </div>
  );
}
