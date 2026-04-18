import { useAppStore } from "../data/store";
import type { CameraMode } from "../data/types";

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

  return (
    <div className="controls panel">
      <div className="label">Kameraläge</div>
      {MODES.map((m) => {
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
