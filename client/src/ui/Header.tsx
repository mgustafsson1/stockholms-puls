import { useMemo } from "react";
import { useAppStore } from "../data/store";
import { useDraggable } from "./useDraggable";
import { useCollapsible, CollapseButton } from "./useCollapsible";

const MODE_SINGULAR: Record<string, string> = {
  subway: "Tunnelbana",
  rail: "Pendeltåg",
  lightrail: "Lokalbana",
  tram: "Spårvagn",
  ferry: "Pendelbåt",
  bus: "Buss",
};
const MODE_PLURAL: Record<string, string> = {
  subway: "tunnelbana",
  rail: "pendeltåg",
  lightrail: "lokalbanor",
  tram: "spårvagnar",
  ferry: "pendelbåtar",
  bus: "bussar",
};

function joinSv(parts: string[]) {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} och ${parts[parts.length - 1]}`;
}

export function Header() {
  const connected = useAppStore((s) => s.connected);
  const source = useAppStore((s) => s.source);
  const trains = useAppStore((s) => s.trains);
  const alerts = useAppStore((s) => s.alerts);
  const lastAt = useAppStore((s) => s.lastSnapshotAt);
  const regionId = useAppStore((s) => s.regionId);
  const regions = useAppStore((s) => s.regions);
  const hiddenLineIds = useAppStore((s) => s.hiddenLineIds);
  const hiddenModes = useAppStore((s) => s.hiddenModes);
  const drag = useDraggable({ storageKey: "header", defaultAnchor: { left: 20, top: 20 } });
  const { collapsed, toggle } = useCollapsible("header");

  const regionLabel = regions.find((r) => r.id === regionId)?.label ?? regionId;

  // Count only traffic that is actually activated (not hidden by line/mode
  // filters) so the header mirrors what the user sees on the map.
  const stats = useMemo(() => {
    let ok = 0, delayed = 0, stopped = 0, total = 0;
    const modes = new Map<string, number>();
    trains.forEach((t) => {
      if (hiddenLineIds.has(t.lineId)) return;
      if (hiddenModes.has(t.mode ?? "")) return;
      total++;
      if (t.status === "ok") ok++;
      else if (t.status === "delayed") delayed++;
      else if (t.status === "stopped") stopped++;
      const m = t.mode ?? "subway";
      modes.set(m, (modes.get(m) ?? 0) + 1);
    });
    return { ok, delayed, stopped, total, modes };
  }, [trains, hiddenLineIds, hiddenModes]);

  const heading = useMemo(() => {
    const activeModes = Array.from(stats.modes.entries())
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([m]) => m);
    if (activeModes.length === 0) return "Kollektivtrafik i realtid";
    if (activeModes.length === 1) return `${MODE_SINGULAR[activeModes[0]] ?? "Trafik"} i realtid`;
    // Take the top 3 modes so we don't produce a 6-word headline for Stockholm.
    const top = activeModes.slice(0, 3).map((m) => MODE_PLURAL[m] ?? m);
    return `${joinSv(top)} i realtid`;
  }, [stats.modes]);

  const sourceLabel = source === "trafiklab" ? "Trafiklab GTFS-RT" : source === "simulator" ? "Simulator" : "Ansluter…";

  return (
    <div ref={drag.ref as any} className="panel" style={{ minWidth: collapsed ? 220 : 280, ...drag.style }} {...drag.handlers}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div className="title" style={{ flex: 1 }}>
          <small>{regionLabel} · Puls</small>
          {heading.charAt(0).toUpperCase() + heading.slice(1)}
        </div>
        <CollapseButton collapsed={collapsed} onToggle={toggle} />
      </div>
      {!collapsed && (
        <>
          <div className="status-row">
            <span>
              <span className="dot" style={{ background: connected ? "#4bd582" : "#ffc04a" }} />
              {connected ? "Ansluten" : "Ansluter…"}
            </span>
            <span>Källa: <strong style={{ color: "#fff" }}>{sourceLabel}</strong></span>
            {lastAt > 0 && <span style={{ fontFamily: "JetBrains Mono, monospace" }}>{new Date(lastAt).toLocaleTimeString("sv-SE")}</span>}
          </div>
          <div className="stats">
            <div className="cell"><div className="num">{stats.total}</div><div className="lbl">Fordon i trafik</div></div>
            <div className="cell"><div className="num" style={{ color: "#4bd582" }}>{stats.ok}</div><div className="lbl">I tid</div></div>
            <div className="cell"><div className="num" style={{ color: "#ffc04a" }}>{stats.delayed}</div><div className="lbl">Försenade</div></div>
            <div className="cell"><div className="num" style={{ color: "#ff3030" }}>{stats.stopped}</div><div className="lbl">Stillastående</div></div>
            <div className="cell"><div className="num">{alerts.length}</div><div className="lbl">Störningar</div></div>
          </div>
        </>
      )}
    </div>
  );
}
