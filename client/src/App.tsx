import { useTrafficStream } from "./data/useTrafficStream";
import { useAppStore } from "./data/store";
import { Scene } from "./scene/Scene";
import { Controls } from "./ui/Controls";
import { Legend } from "./ui/Legend";
import { Header } from "./ui/Header";
import { Alerts } from "./ui/Alerts";
import { InfoPanel } from "./ui/InfoPanel";
import { StationInfoPanel } from "./ui/StationInfoPanel";
import { AIPanel } from "./ui/AIPanel";
import { StationSearch } from "./ui/StationSearch";
import { TrendPanel } from "./ui/TrendPanel";
import { RegionSelector } from "./ui/RegionSelector";
import { ReplayTimeline } from "./ui/ReplayTimeline";

export default function App() {
  useTrafficStream();
  const network = useAppStore((s) => s.network);
  const connected = useAppStore((s) => s.connected);
  const showLabels = useAppStore((s) => s.showLabels);
  const setShowLabels = useAppStore((s) => s.setShowLabels);
  const trains = useAppStore((s) => s.trains);
  const regionId = useAppStore((s) => s.regionId);
  const regions = useAppStore((s) => s.regions);
  const lastSnapshotAt = useAppStore((s) => s.lastSnapshotAt);
  const replayActive = useAppStore((s) => s.replayActive);
  // After a region switch `trains` is cleared and the server may need up to
  // one poll cycle (~45 s) before data arrives. Show a "waiting for data"
  // toast so the user doesn't assume it's broken.
  const waitingForData = !!network && connected && !replayActive && trains.size === 0;
  const regionLabel = regions.find((r) => r.id === regionId)?.label ?? regionId;
  // Silence the unused-variable lint for lastSnapshotAt — we keep it in the
  // selector list so the component re-renders when snapshots arrive.
  void lastSnapshotAt;

  return (
    <div className="app">
      <Scene />
      <div className="ui-overlay">
        <Header />
        <StationSearch />
        <RegionSelector />
        <Controls />
        <Legend />
        <Alerts />
        <InfoPanel />
        <StationInfoPanel />
        <AIPanel />
        <TrendPanel />
        <ReplayTimeline />
        <button
          onClick={() => setShowLabels(!showLabels)}
          className="panel"
          style={{
            position: "absolute",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "8px 14px",
            fontSize: 11,
            letterSpacing: 0.14,
            textTransform: "uppercase",
            background: showLabels ? "rgba(124,196,255,0.12)" : "rgba(10,15,28,0.72)",
            borderColor: showLabels ? "rgba(124,196,255,0.4)" : "rgba(255,255,255,0.06)",
            color: showLabels ? "#fff" : "#8b98ad",
            cursor: "pointer",
          }}
        >
          {showLabels ? "Dölj etiketter" : "Visa etiketter"}
        </button>
        <div className="footer" style={{ bottom: 60 }}>Data via Trafiklab GTFS-RT · Karta © OpenStreetMap · CartoDB · {network?.stations.length ?? "—"} stationer</div>
      </div>
      {!network && (
        <div className="loading">
          <div className="row"><div className="spinner" /> Läser in tunnelbanenätet…</div>
        </div>
      )}
      {network && !connected && (
        <div className="loading" style={{ alignItems: "start", paddingTop: 120 }}>
          <div className="row"><div className="spinner" /> Återansluter realtidsström…</div>
        </div>
      )}
      {waitingForData && (
        <div
          className="panel"
          style={{
            position: "fixed",
            top: 80,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            pointerEvents: "none",
            background: "rgba(10,15,28,0.92)",
            border: "1px solid rgba(124,196,255,0.35)",
          }}
        >
          <div className="spinner" style={{ width: 14, height: 14 }} />
          <div style={{ fontSize: 12, color: "#c7cfdc" }}>
            Väntar på trafikdata för <strong style={{ color: "#fff" }}>{regionLabel}</strong>
            <span style={{ color: "#8b98ad", marginLeft: 8 }}>— första uppdatering inom ~45 s</span>
          </div>
        </div>
      )}
    </div>
  );
}
