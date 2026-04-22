import { useEffect, useState, type ReactNode } from "react";
import { useAppStore } from "../data/store";
import { Controls } from "./Controls";
import { Legend } from "./Legend";
import { Header } from "./Header";
import { Alerts } from "./Alerts";
import { InfoPanel } from "./InfoPanel";
import { StationInfoPanel } from "./StationInfoPanel";
import { AIPanel } from "./AIPanel";
import { StationSearch } from "./StationSearch";
import { TrendPanel } from "./TrendPanel";
import { RegionSelector } from "./RegionSelector";
import { ReplayTimeline } from "./ReplayTimeline";

type View =
  | "menu"
  | "sok"
  | "region"
  | "stats"
  | "ai"
  | "storningar"
  | "trender"
  | "kamera"
  | "filter"
  | "replay"
  | "info"
  | "station";

interface MenuItem {
  id: View;
  label: string;
  sub?: string;
  count?: number | null;
  icon: string;
  render: () => ReactNode;
}

export function MobileShell() {
  const alerts = useAppStore((s) => s.alerts);
  const selectedTrainId = useAppStore((s) => s.selectedTrainId);
  const selectedStationId = useAppStore((s) => s.selectedStationId);
  const regionId = useAppStore((s) => s.regionId);
  const regions = useAppStore((s) => s.regions);
  const aiAnalysis = useAppStore((s) => s.aiAnalysis);

  const regionLabel = regions.find((r) => r.id === regionId)?.label ?? regionId;

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");

  // Auto-switch to the info sheet when a train or station is selected, so
  // tapping something in the scene feels like it actually did something.
  useEffect(() => {
    if (selectedTrainId) {
      setView("info");
      setOpen(true);
    }
  }, [selectedTrainId]);
  useEffect(() => {
    if (selectedStationId) {
      setView("station");
      setOpen(true);
    }
  }, [selectedStationId]);

  const severeAlerts = alerts.filter((a) => a.severity === "SEVERE").length;

  const items: MenuItem[] = [
    {
      id: "sok",
      label: "Sök station",
      sub: "hållplatser, pendeltåg, metro",
      icon: "⌕",
      render: () => <StationSearch />,
    },
    {
      id: "region",
      label: "Region",
      sub: regionLabel,
      icon: "◎",
      render: () => <RegionSelector />,
    },
    {
      id: "stats",
      label: "Läge & statistik",
      sub: "Fordon, status, senaste snapshot",
      icon: "▤",
      render: () => <Header />,
    },
    {
      id: "ai",
      label: "AI-analys",
      sub: aiAnalysis?.summary ? aiAnalysis.summary.slice(0, 50) + (aiAnalysis.summary.length > 50 ? "…" : "") : "Väntar på första analysen",
      icon: "◐",
      render: () => <AIPanel />,
    },
    {
      id: "storningar",
      label: "Störningar",
      sub: alerts.length ? `${alerts.length} aktiva` : "Inga aktiva",
      count: alerts.length || null,
      icon: "⚠",
      render: () => <Alerts />,
    },
    {
      id: "trender",
      label: "Trender",
      sub: "Försenade, stopp, punktlighet",
      icon: "∿",
      render: () => <TrendPanel />,
    },
    {
      id: "kamera",
      label: "Kameraläge",
      sub: "Översikt · bergsnitt · följ fordon",
      icon: "⎋",
      render: () => <Controls />,
    },
    {
      id: "filter",
      label: "Teckenförklaring & filter",
      sub: "Linjer, bussar, karta, byggnader",
      icon: "⊞",
      render: () => <Legend />,
    },
    {
      id: "replay",
      label: "Historik / replay",
      sub: "Scrubba tillbaka upp till 3 h",
      icon: "↺",
      render: () => <ReplayTimeline />,
    },
  ];

  // Only surface info/station rendering when their state is active.
  const renderView = () => {
    if (view === "info") return <InfoPanel />;
    if (view === "station") return <StationInfoPanel />;
    const item = items.find((i) => i.id === view);
    return item?.render() ?? null;
  };

  const activeTitle = (() => {
    if (view === "info") return "Fordonsinfo";
    if (view === "station") return "Stationsinfo";
    return items.find((i) => i.id === view)?.label ?? "Paneler";
  })();

  const badgeCount = severeAlerts || (alerts.length > 20 ? alerts.length : 0);

  return (
    <>
      <button
        className="mobile-panel-drawer-btn"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) setView("menu");
        }}
        aria-label={open ? "Stäng menu" : "Visa menu"}
      >
        {open ? "× Stäng" : "☰ Meny"}
        {!open && badgeCount > 0 && (
          <span
            style={{
              marginLeft: 8,
              background: severeAlerts ? "#ff3d4a" : "#ffc04a",
              color: "#04060c",
              borderRadius: 10,
              padding: "1px 6px",
              fontSize: 10,
              fontWeight: 700,
            }}
          >{badgeCount}</span>
        )}
      </button>

      <div className={`mobile-panel-drawer ${open ? "open" : "closed"}`}>
        <div className="mobile-panel-drawer-handle">
          {view !== "menu" ? (
            <button
              onClick={() => setView("menu")}
              aria-label="Tillbaka"
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.14)",
                color: "#c7cfdc",
                padding: "4px 10px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "inherit",
              }}
            >← Meny</button>
          ) : (
            <span style={{ fontSize: 11, color: "#8b98ad", letterSpacing: 0.1, textTransform: "uppercase" }}>
              Paneler
            </span>
          )}
          <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", textAlign: "center", flex: 1 }}>
            {view !== "menu" && activeTitle}
          </span>
          <button
            onClick={() => setOpen(false)}
            aria-label="Stäng"
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.14)",
              color: "#c7cfdc",
              width: 28, height: 28, borderRadius: 6,
              cursor: "pointer",
              fontSize: 14,
            }}
          >×</button>
        </div>

        <div className="mobile-panel-drawer-body">
          {view === "menu" ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => setView(item.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 10,
                      color: "#fff",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                    }}
                  >
                    <span style={{
                      fontSize: 18,
                      width: 28,
                      height: 28,
                      flexShrink: 0,
                      borderRadius: 6,
                      background: "rgba(124,196,255,0.12)",
                      color: "#7cc4ff",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}>{item.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</div>
                      {item.sub && (
                        <div style={{ fontSize: 11, color: "#8b98ad", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.sub}
                        </div>
                      )}
                    </div>
                    {item.count != null && item.count > 0 && (
                      <span style={{
                        background: "rgba(255,192,74,0.15)",
                        color: "#ffc04a",
                        padding: "2px 8px",
                        borderRadius: 10,
                        fontSize: 11,
                        fontWeight: 600,
                      }}>{item.count}</span>
                    )}
                    <span style={{ color: "#8b98ad", fontSize: 14 }}>›</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div key={view}>{renderView()}</div>
          )}
        </div>
      </div>
    </>
  );
}
