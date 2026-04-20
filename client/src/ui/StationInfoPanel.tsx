import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../data/store";
import { computeStationBoard, formatEta, type BoardEntry } from "../data/stationBoard";
import { useDraggable } from "./useDraggable";
import { useCollapsible, CollapseButton } from "./useCollapsible";

interface OfficialDeparture {
  scheduled: string;
  realtime: string;
  delay: number;
  canceled: boolean;
  isRealtime: boolean;
  line: string;
  direction: string;
  mode: string | null;
  destination: string | null;
  scheduledPlatform: string | null;
  realtimePlatform: string | null;
  agency: string | null;
  tripId: string | null;
  alerts: number;
}

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

  // Pull authoritative departures from Trafiklab Timetables when a station
  // is selected. Refreshes every 20 s while the panel is open.
  const [official, setOfficial] = useState<OfficialDeparture[] | null>(null);
  const [officialError, setOfficialError] = useState<string | null>(null);
  useEffect(() => {
    if (!station) { setOfficial(null); setOfficialError(null); return; }
    // Only numeric ids map to rikshållplats; skip otherwise.
    if (!/^[0-9]+$/.test(station.id)) { setOfficial(null); return; }
    let cancelled = false;
    setOfficialError(null);
    const fetchDepartures = async () => {
      try {
        const r = await fetch(`/api/departures?stopId=${encodeURIComponent(station.id)}&duration=60`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!cancelled) setOfficial(j.departures ?? []);
      } catch (e: any) {
        if (!cancelled) {
          setOfficial([]);
          setOfficialError(e.message);
        }
      }
    };
    fetchDepartures();
    const h = window.setInterval(fetchDepartures, 20_000);
    return () => { cancelled = true; window.clearInterval(h); };
  }, [station?.id]);

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

      {!collapsed && <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ fontSize: 10, color: "#8b98ad", letterSpacing: 0.18, textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <span>Avgångar</span>
          <span style={{ color: "#5a697f", fontSize: 9, textTransform: "none", letterSpacing: 0 }}>via Trafiklab Timetables</span>
        </div>
        {official === null ? (
          <div style={{ fontSize: 12, color: "#6b778c", padding: "12px 0" }}>Laddar…</div>
        ) : officialError ? (
          <div style={{ fontSize: 11, color: "#ff9090", padding: "12px 0" }}>Kunde inte hämta tidtabell: {officialError}</div>
        ) : official.length === 0 ? (
          <div style={{ fontSize: 12, color: "#6b778c", padding: "12px 0" }}>
            Inga avgångar i närtid.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", paddingRight: 4 }}>
            {official.slice(0, 30).map((d, i) => (
              <DepartureRow key={`${d.tripId ?? i}-${d.scheduled}`} dep={d} />
            ))}
          </div>
        )}

        {upcoming.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: 10, color: "#8b98ad", letterSpacing: 0.18, textTransform: "uppercase", marginBottom: 8 }}>
              Spårade fordon på väg hit
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {upcoming.slice(0, 5).map((e) => (
                <BoardRow key={e.trainId} entry={e} />
              ))}
            </div>
          </div>
        )}
      </div>}
    </div>
  );
}

function DepartureRow({ dep }: { dep: OfficialDeparture }) {
  const timeStr = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  };
  const schedTime = timeStr(dep.scheduled);
  const realTime = dep.realtime !== dep.scheduled ? timeStr(dep.realtime) : null;
  const color = dep.canceled ? "#ff3030" : dep.delay >= 60 ? "#ffc04a" : "#4bd582";
  const statusText = dep.canceled
    ? "Inställd"
    : dep.delay >= 60
      ? `+${Math.round(dep.delay / 60)} min`
      : dep.isRealtime ? "I tid" : "";
  const platform = dep.realtimePlatform ?? dep.scheduledPlatform;
  const modeShort: Record<string, string> = {
    TRAIN: "TÅG", BUS: "BUSS", METRO: "T-BANA", TRAM: "SPÅRV", FERRY: "BÅT",
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 8,
        background: dep.canceled ? "rgba(255,48,48,0.06)" : "rgba(255,255,255,0.025)",
        border: `1px solid ${dep.canceled ? "rgba(255,48,48,0.25)" : "rgba(255,255,255,0.05)"}`,
      }}
    >
      <span
        style={{
          background: "#2a3550",
          color: "#fff",
          padding: "3px 8px",
          borderRadius: 5,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.02,
          minWidth: 40,
          textAlign: "center",
        }}
      >{dep.line || modeShort[dep.mode ?? ""] || "—"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          mot {dep.direction || dep.destination || "—"}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 2, alignItems: "center", fontSize: 10, color: "#8b98ad" }}>
          {dep.agency && <span style={{ color: "#8b98ad" }}>{dep.agency}</span>}
          {platform && <span style={{ color: "#c7cfdc" }}>Plf {platform}</span>}
          {dep.alerts > 0 && <span style={{ color: "#ffc04a" }}>{dep.alerts} störning{dep.alerts === 1 ? "" : "ar"}</span>}
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 60 }}>
        <div style={{
          fontSize: 15,
          fontWeight: 700,
          color: dep.canceled ? "#ff3030" : "#fff",
          fontVariantNumeric: "tabular-nums",
          textDecoration: dep.canceled ? "line-through" : "none",
        }}>{realTime ?? schedTime}</div>
        {statusText && (
          <div style={{ fontSize: 10, color, marginTop: 2, fontWeight: 600 }}>{statusText}</div>
        )}
      </div>
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
