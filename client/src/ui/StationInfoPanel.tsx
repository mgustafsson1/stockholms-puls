import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../data/store";
import { computeStationBoard, formatEta, type BoardEntry } from "../data/stationBoard";
import { useDraggable } from "./useDraggable";
import { useCollapsible, CollapseButton } from "./useCollapsible";

const LINE_HEX: Record<string, string> = {
  red: "#ff3d4a",
  green: "#4bd582",
  blue: "#39a7ff",
};

const MODE_BADGE: Record<string, { color: string; label: string }> = {
  subway: { color: "#ffffff", label: "T-BANA" },
  rail: { color: "#ff7a1f", label: "PENDEL" },
  lightrail: { color: "#b084ff", label: "SPÅRVÄG" },
  tram: { color: "#f4c430", label: "SPÅRVAGN" },
  ferry: { color: "#24d4d4", label: "BÅT" },
};

const STATUS_COLOR: Record<string, string> = {
  ok: "#4bd582",
  delayed: "#ffc04a",
  stopped: "#ff3030",
};

export function StationInfoPanel() {
  const selectedStationId = useAppStore((s) => s.selectedStationId);
  const network = useAppStore((s) => s.network);
  const trains = useAppStore((s) => s.trains);
  const setSelected = useAppStore((s) => s.setSelectedStation);
  const drag = useDraggable({ storageKey: "station-panel", defaultAnchor: { right: 20, top: 160 } });
  const { collapsed, toggle } = useCollapsible("station-panel");

  const station = useMemo(() => {
    if (!network || !selectedStationId) return null;
    return network.stations.find((s) => s.id === selectedStationId) ?? null;
  }, [network, selectedStationId]);

  const [, tick] = useState(0);
  useEffect(() => {
    if (!station) return;
    const h = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, [station]);

  const board = useMemo(() => {
    if (!station || !network) return [];
    return computeStationBoard(station.id, trains.values(), network);
  }, [station, trains, network]);

  if (!station || !network) return null;

  const depthLabel = station.depth > 0 ? `${station.depth} m under mark` : "marknivå";
  const linesAtStation = station.lines ?? [];
  const modeBadge = linesAtStation.length === 0 ? MODE_BADGE[station.mode ?? "subway"] : null;

  const upcoming = board.slice(0, 10);

  return (
    <div
      ref={drag.ref as any}
      className="panel"
      style={{
        minWidth: 320,
        maxWidth: 360,
        maxHeight: "calc(100vh - 200px)",
        pointerEvents: "auto",
        zIndex: 8,
        display: "flex",
        flexDirection: "column",
        ...drag.style,
      }}
      {...drag.handlers}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: "#8b98ad", letterSpacing: 0.18, textTransform: "uppercase", marginBottom: 4 }}>Station</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", lineHeight: 1.1 }}>{station.name}</div>
          <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
            {linesAtStation.map((lg) => (
              <span
                key={lg}
                style={{
                  background: LINE_HEX[lg] ?? "#888",
                  color: "#04060c",
                  padding: "2px 7px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.04,
                }}
              >
                {lg === "red" ? "RÖD" : lg === "green" ? "GRÖN" : lg === "blue" ? "BLÅ" : lg.toUpperCase()}
              </span>
            ))}
            {modeBadge && (
              <span
                style={{
                  background: modeBadge.color,
                  color: "#04060c",
                  padding: "2px 7px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.04,
                }}
              >{modeBadge.label}</span>
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#8b98ad" }}>
            {depthLabel} · {station.lat.toFixed(4)}, {station.lon.toFixed(4)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <CollapseButton collapsed={collapsed} onToggle={toggle} />
          <button
            onClick={() => setSelected(null)}
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

      {!collapsed && <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 10, color: "#8b98ad", letterSpacing: 0.18, textTransform: "uppercase", marginBottom: 10 }}>
          Ankomster
        </div>
        {upcoming.length === 0 ? (
          <div style={{ fontSize: 12, color: "#6b778c", padding: "12px 0" }}>
            Inga tåg på väg just nu.
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              overflowY: "auto",
              maxHeight: "calc(100vh - 380px)",
              paddingRight: 4,
            }}
          >
            {upcoming.map((e) => (
              <BoardRow key={e.trainId} entry={e} />
            ))}
          </div>
        )}
      </div>}
    </div>
  );
}

function BoardRow({ entry }: { entry: BoardEntry }) {
  const eta = formatEta(entry.etaSeconds);
  const statusColor = STATUS_COLOR[entry.status];
  const isNow = entry.atStation || entry.etaSeconds < 30;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 8,
        background: isNow ? "rgba(75, 213, 130, 0.08)" : "rgba(255,255,255,0.025)",
        border: `1px solid ${isNow ? "rgba(75,213,130,0.25)" : "rgba(255,255,255,0.05)"}`,
      }}
    >
      <span
        style={{
          background: entry.color,
          color: "#04060c",
          padding: "3px 8px",
          borderRadius: 5,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.02,
          minWidth: 36,
          textAlign: "center",
        }}
      >{entry.lineId}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          mot {entry.terminusName}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 2, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: statusColor, fontWeight: 600, letterSpacing: 0.04, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
            {entry.status === "ok" ? "I tid" : entry.status === "delayed" ? `+${Math.round(entry.delay)}s` : "Stopp"}
          </span>
          {entry.via && (
            <span style={{ fontSize: 10, color: "#6b778c" }}>via {entry.via}</span>
          )}
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 48 }}>
        <div style={{
          fontSize: isNow ? 13 : 15,
          fontWeight: 700,
          color: isNow ? "#4bd582" : "#fff",
          fontVariantNumeric: "tabular-nums",
        }}>{eta}</div>
      </div>
    </div>
  );
}
