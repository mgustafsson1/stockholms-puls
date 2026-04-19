import { useMemo, useEffect, useState } from "react";
import { useAppStore } from "../data/store";
import { useDraggable } from "./useDraggable";
import { useCollapsible, CollapseButton } from "./useCollapsible";

const STATUS_LABEL: Record<string, string> = {
  ok: "I tid",
  delayed: "Försenat",
  stopped: "Stillastående",
};

const STATUS_COLOR: Record<string, string> = {
  ok: "#4bd582",
  delayed: "#ffc04a",
  stopped: "#ff3030",
};

export function InfoPanel() {
  const hoveredTrainId = useAppStore((s) => s.hoveredTrainId);
  const selectedTrainId = useAppStore((s) => s.selectedTrainId);
  const trains = useAppStore((s) => s.trains);
  const network = useAppStore((s) => s.network);
  const setSelected = useAppStore((s) => s.setSelectedTrain);
  const setFollow = useAppStore((s) => s.setFollowTrain);
  const drag = useDraggable({ storageKey: "info-panel", defaultAnchor: { right: 20, top: 160 } });
  const { collapsed, toggle } = useCollapsible("info-panel");

  const activeId = selectedTrainId || hoveredTrainId;
  const train = activeId ? trains.get(activeId) : null;

  const [, force] = useState(0);
  useEffect(() => {
    if (!train) return;
    const h = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(h);
  }, [train]);

  const meta = useMemo(() => {
    if (!train || !network) return null;
    const line = network.lines.find((l) => l.id === train.lineId);
    const from = network.stations.find((s) => s.id === train.from);
    const to = network.stations.find((s) => s.id === train.to);
    if (!line || !from) return null;

    const idx = line.stations.indexOf(train.from);
    const dirLabel = train.direction === 1 ? "→" : "←";
    const terminus = train.direction === 1 ? line.stations[line.stations.length - 1] : line.stations[0];
    const terminusStation = network.stations.find((s) => s.id === terminus);

    const depthLabel = train.depth > 0 ? `${Math.round(train.depth)} m under mark` : "marknivå";

    return { line, from, to, terminusStation, dirLabel, idx, depthLabel };
  }, [train, network]);

  if (!train || !meta) return null;

  const statusColor = STATUS_COLOR[train.status];

  return (
    <div
      ref={drag.ref as any}
      className="panel info-panel"
      style={{
        minWidth: 280,
        maxWidth: 320,
        pointerEvents: "auto",
        zIndex: 8,
        ...drag.style,
      }}
      {...drag.handlers}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <div style={{
            display: "inline-block",
            padding: "3px 9px",
            borderRadius: 6,
            background: meta.line.color,
            color: "#04060c",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: 0.02,
          }}>{train.lineId}</div>
          <div style={{ fontSize: 11, color: "#8b98ad", marginTop: 6, letterSpacing: 0.1, textTransform: "uppercase" }}>
            Tåg {train.id.split("-").slice(-1)[0]}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <CollapseButton collapsed={collapsed} onToggle={toggle} />
          <button
            onClick={() => { setSelected(null); setFollow(null); }}
            data-nodrag
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.14)",
              color: "#8b98ad",
              width: 26, height: 26, borderRadius: 6,
              cursor: "pointer",
              fontSize: 14,
            }}
            aria-label="Stäng"
          >×</button>
        </div>
      </div>

      {!collapsed && <>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 11, color: "#8b98ad", letterSpacing: 0.14, textTransform: "uppercase", marginBottom: 4 }}>
          {meta.dirLabel === "→" ? "Mot" : "Från"} riktning
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{meta.terminusStation?.name}</div>
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, fontSize: 13, color: "#c7cfdc" }}>
          <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase" }}>Från</div>
          {meta.from.name}
        </div>
        <div style={{ color: "#5a697f", fontSize: 20 }}>{meta.dirLabel}</div>
        <div style={{ flex: 1, fontSize: 13, color: "#c7cfdc", textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase" }}>Till</div>
          {meta.to?.name ?? meta.from.name}
        </div>
      </div>

      {!train.atStation && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase", marginBottom: 4 }}>Position</div>
          <div style={{ background: "rgba(255,255,255,0.04)", height: 4, borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${Math.round(train.progress * 100)}%`,
              background: meta.line.color,
              transition: "width 0.4s ease-out",
            }} />
          </div>
          <div style={{ fontSize: 10, color: "#8b98ad", marginTop: 4 }}>{Math.round(train.progress * 100)}% av sträckan</div>
        </div>
      )}

      <div style={{
        marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)",
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
      }}>
        <div>
          <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase" }}>Status</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: statusColor, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, boxShadow: `0 0 10px ${statusColor}` }} />
            {STATUS_LABEL[train.status]}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase" }}>Försening</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: train.delay > 0 ? "#ffc04a" : "#8b98ad", marginTop: 2 }}>
            {train.delay > 0 ? `+${Math.round(train.delay)}s` : "—"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase" }}>Djup</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#c7cfdc", marginTop: 2 }}>{meta.depthLabel}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase" }}>Koordinat</div>
          <div style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#c7cfdc", marginTop: 2 }}>
            {train.lat.toFixed(4)}, {train.lon.toFixed(4)}
          </div>
        </div>
      </div>

      {selectedTrainId === train.id && (
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <button
            onClick={() => setFollow(train.id)}
            style={{
              flex: 1,
              background: "rgba(124, 196, 255, 0.12)",
              border: "1px solid rgba(124,196,255,0.4)",
              color: "#fff",
              padding: "8px 10px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 12,
            }}
          >Följ tåget</button>
        </div>
      )}
      </>}
    </div>
  );
}
