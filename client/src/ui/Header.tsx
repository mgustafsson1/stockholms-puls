import { useMemo } from "react";
import { useAppStore } from "../data/store";
import { useDraggable } from "./useDraggable";
import { useCollapsible, CollapseButton } from "./useCollapsible";

export function Header() {
  const connected = useAppStore((s) => s.connected);
  const source = useAppStore((s) => s.source);
  const trains = useAppStore((s) => s.trains);
  const alerts = useAppStore((s) => s.alerts);
  const lastAt = useAppStore((s) => s.lastSnapshotAt);
  const drag = useDraggable({ storageKey: "header", defaultAnchor: { left: 20, top: 20 } });
  const { collapsed, toggle } = useCollapsible("header");

  const stats = useMemo(() => {
    let ok = 0, delayed = 0, stopped = 0;
    trains.forEach((t) => {
      if (t.status === "ok") ok++;
      else if (t.status === "delayed") delayed++;
      else if (t.status === "stopped") stopped++;
    });
    return { ok, delayed, stopped, total: trains.size };
  }, [trains]);

  const sourceLabel = source === "trafiklab" ? "Trafiklab GTFS-RT" : source === "simulator" ? "Simulator" : "Ansluter…";

  return (
    <div ref={drag.ref as any} className="panel" style={{ minWidth: collapsed ? 220 : 280, ...drag.style }} {...drag.handlers}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div className="title" style={{ flex: 1 }}>
          <small>Stockholms Puls</small>
          Tunnelbanan i realtid
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
            <div className="cell"><div className="num">{stats.total}</div><div className="lbl">Tåg i trafik</div></div>
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
