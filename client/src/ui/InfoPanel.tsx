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

  if (!train) return null;

  // Buses (and any unmatched vehicle) don't have route/segment metadata.
  // Render a simpler card so clicking them still gives useful info.
  if (!meta) {
    return <BusInfoCard train={train} onClose={() => { setSelected(null); setFollow(null); }} />;
  }

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
          >Följ fordonet</button>
        </div>
      )}
      </>}
    </div>
  );
}

const MODE_LABEL: Record<string, string> = {
  bus: "Buss",
  subway: "Tunnelbana",
  rail: "Pendeltåg / regional",
  lightrail: "Lokalbana",
  tram: "Spårvagn",
  ferry: "Pendelbåt",
};

const OCCUPANCY_LABEL: Record<string, string> = {
  EMPTY: "Tomt",
  MANY_SEATS_AVAILABLE: "Gott om plats",
  FEW_SEATS_AVAILABLE: "Få sittplatser",
  STANDING_ROOM_ONLY: "Endast ståplats",
  CRUSHED_STANDING_ROOM_ONLY: "Fullpackat",
  FULL: "Fullt",
  NOT_ACCEPTING_PASSENGERS: "Tar ej resenärer",
};

const CURRENT_STATUS_LABEL: Record<string, string> = {
  INCOMING_AT: "Ankommer hållplats",
  STOPPED_AT: "Vid hållplats",
  IN_TRANSIT_TO: "Under gång",
};

function bearingLabel(deg: number) {
  const dirs = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSV", "SV", "VSV", "V", "VNV", "NV", "NNV"];
  const idx = Math.round(((deg % 360) / 22.5)) % 16;
  return `${dirs[idx]} ${Math.round(deg)}°`;
}

function relativeAge(ms: number) {
  const age = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (age < 60) return `${age}s sedan`;
  if (age < 3600) return `${Math.floor(age / 60)}m ${age % 60}s sedan`;
  return `${Math.floor(age / 3600)}h sedan`;
}

function BusInfoCard({ train, onClose }: { train: import("../data/types").Train; onClose: () => void }) {
  const selectedTrainId = useAppStore((s) => s.selectedTrainId);
  const setFollow = useAppStore((s) => s.setFollowTrain);
  const drag = useDraggable({ storageKey: "info-panel", defaultAnchor: { right: 20, top: 160 } });
  const { collapsed, toggle } = useCollapsible("info-panel");

  // Force a re-render every second so the "updated N seconds ago" line stays
  // live even when no new snapshot arrives for this vehicle.
  const [, force] = useState(0);
  useEffect(() => {
    const h = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(h);
  }, []);

  const statusColor = STATUS_COLOR[train.status] ?? "#8b98ad";
  const modeLabel = MODE_LABEL[train.mode ?? "bus"] ?? "Fordon";
  const shortId = train.id.split("-").slice(-1)[0];
  const lineLabel = train.lineId && train.lineId !== "BUS" ? train.lineId : "?";
  const destination = train.headsign || train.routeLong || null;
  const speedKmh = typeof train.speed === "number" ? Math.round(train.speed * 3.6) : null;
  const bearing = typeof train.bearing === "number" ? bearingLabel(train.bearing) : null;
  const occupancy = train.occupancy ? (OCCUPANCY_LABEL[train.occupancy] ?? train.occupancy) : null;
  const currentStatus = train.currentStatus ? (CURRENT_STATUS_LABEL[train.currentStatus] ?? train.currentStatus) : null;
  const feedAge = train.feedTimestamp ? relativeAge(train.feedTimestamp) : null;

  return (
    <div
      ref={drag.ref as any}
      className="panel info-panel"
      style={{
        minWidth: 260,
        maxWidth: 310,
        pointerEvents: "auto",
        zIndex: 8,
        ...drag.style,
      }}
      {...drag.handlers}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 34,
              padding: "3px 10px",
              borderRadius: 6,
              background: train.color || "#7f88a0",
              color: "#04060c",
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: 0.02,
            }}>{lineLabel}</div>
            <div style={{ fontSize: 11, color: "#8b98ad", letterSpacing: 0.1, textTransform: "uppercase" }}>
              {modeLabel}
            </div>
          </div>
          {destination && (
            <div style={{ fontSize: 13.5, color: "#fff", marginTop: 8, fontWeight: 500, lineHeight: 1.3 }}>
              {destination}
            </div>
          )}
          {train.agency && (
            <div style={{ fontSize: 11, color: "#8b98ad", marginTop: 4 }}>
              {train.agency}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <CollapseButton collapsed={collapsed} onToggle={toggle} />
          <button
            onClick={onClose}
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
      {currentStatus && (
        <div style={{ marginTop: 12, fontSize: 12, color: "#c7cfdc" }}>{currentStatus}</div>
      )}

      <div style={{
        marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)",
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
      }}>
        <div>
          <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase" }}>Status</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: statusColor, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, boxShadow: `0 0 10px ${statusColor}` }} />
            {STATUS_LABEL[train.status] ?? "—"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase" }}>Försening</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: train.delay > 0 ? "#ffc04a" : "#8b98ad", marginTop: 2 }}>
            {train.delay > 0 ? `+${Math.round(train.delay)}s` : "—"}
          </div>
        </div>
        {speedKmh != null && (
          <div>
            <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase" }}>Hastighet</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#c7cfdc", marginTop: 2 }}>{speedKmh} km/h</div>
          </div>
        )}
        {bearing && (
          <div>
            <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase" }}>Riktning</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#c7cfdc", marginTop: 2 }}>{bearing}</div>
          </div>
        )}
        {occupancy && (
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase" }}>Beläggning</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#c7cfdc", marginTop: 2 }}>{occupancy}</div>
          </div>
        )}
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase" }}>Fordon</div>
          <div style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#c7cfdc", marginTop: 2 }}>
            {train.vehicleLabel || shortId}
            {train.licensePlate ? ` · ${train.licensePlate}` : ""}
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase" }}>Position</div>
          <div style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#c7cfdc", marginTop: 2 }}>
            {train.lat.toFixed(4)}, {train.lon.toFixed(4)}
          </div>
        </div>
        {feedAge && (
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 10, color: "#6b778c", letterSpacing: 0.16, textTransform: "uppercase" }}>Senaste uppdatering</div>
            <div style={{ fontSize: 12, color: "#c7cfdc", marginTop: 2 }}>{feedAge}</div>
          </div>
        )}
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
          >Följ fordonet</button>
        </div>
      )}
      </>}
    </div>
  );
}
