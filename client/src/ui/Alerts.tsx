import { useMemo, useState } from "react";
import { useAppStore } from "../data/store";
import { useDraggable } from "./useDraggable";
import { useCollapsible, CollapseButton } from "./useCollapsible";
import type { Alert } from "../data/types";

type Severity = "SEVERE" | "WARNING" | "INFO" | "UNKNOWN_SEVERITY";

const SEVERITY_ORDER: Record<Severity, number> = {
  SEVERE: 0,
  WARNING: 1,
  INFO: 2,
  UNKNOWN_SEVERITY: 3,
};

const SEVERITY_COLOR: Record<Severity, string> = {
  SEVERE: "#ff3d4a",
  WARNING: "#ffc04a",
  INFO: "#7cc4ff",
  UNKNOWN_SEVERITY: "#8b98ad",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  SEVERE: "Allvarlig",
  WARNING: "Varning",
  INFO: "Info",
  UNKNOWN_SEVERITY: "Okänd",
};

const CAUSE_LABEL: Record<string, string> = {
  TECHNICAL_PROBLEM: "Tekniskt fel",
  ACCIDENT: "Olycka",
  WEATHER: "Väder",
  MAINTENANCE: "Underhåll",
  CONSTRUCTION: "Vägarbete",
  STRIKE: "Strejk",
  DEMONSTRATION: "Demonstration",
  POLICE_ACTIVITY: "Polisinsats",
  MEDICAL_EMERGENCY: "Sjukdomsfall",
  HOLIDAY: "Helgdag",
  OTHER_CAUSE: "Övrig orsak",
};

function normalize(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function Alerts() {
  const alerts = useAppStore((s) => s.alerts);
  const setSelectedStation = useAppStore((s) => s.setSelectedStation);
  const drag = useDraggable({ storageKey: "alerts-panel", defaultAnchor: { right: 20, bottom: 280 } });
  const { collapsed, toggle } = useCollapsible("alerts-panel");
  const [query, setQuery] = useState("");
  const [activeSeverity, setActiveSeverity] = useState<Severity | "ALL">("ALL");

  const sevCounts = useMemo(() => {
    const c: Record<Severity, number> = { SEVERE: 0, WARNING: 0, INFO: 0, UNKNOWN_SEVERITY: 0 };
    for (const a of alerts) {
      const s = (a.severity ?? "UNKNOWN_SEVERITY") as Severity;
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [alerts]);

  const filtered = useMemo(() => {
    const q = query.trim() ? normalize(query) : "";
    return alerts
      .filter((a) => {
        const sev = (a.severity ?? "UNKNOWN_SEVERITY") as Severity;
        if (activeSeverity !== "ALL" && sev !== activeSeverity) return false;
        if (!q) return true;
        const hay = normalize(
          `${a.header ?? ""} ${a.message ?? ""} ${a.description ?? ""} ${(a.lineIds ?? []).join(" ")} ${a.stationName ?? ""}`
        );
        return hay.includes(q);
      })
      .sort((a, b) => {
        const sa = (a.severity ?? "UNKNOWN_SEVERITY") as Severity;
        const sb = (b.severity ?? "UNKNOWN_SEVERITY") as Severity;
        if (SEVERITY_ORDER[sa] !== SEVERITY_ORDER[sb]) return SEVERITY_ORDER[sa] - SEVERITY_ORDER[sb];
        return (a.header ?? a.message ?? "").localeCompare(b.header ?? b.message ?? "", "sv");
      });
  }, [alerts, query, activeSeverity]);

  if (!alerts.length) return null;

  return (
    <div
      ref={drag.ref as any}
      className="panel"
      style={{
        minWidth: 320,
        maxWidth: 360,
        maxHeight: "calc(100vh - 140px)",
        display: "flex",
        flexDirection: "column",
        pointerEvents: "auto",
        zIndex: 9,
        ...drag.style,
      }}
      {...drag.handlers}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: "#8b98ad", letterSpacing: 0.18, textTransform: "uppercase" }}>Störningar</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginTop: 2 }}>
            {alerts.length} aktiva
            {sevCounts.SEVERE > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, color: SEVERITY_COLOR.SEVERE, fontWeight: 500 }}>
                {sevCounts.SEVERE} allvarliga
              </span>
            )}
          </div>
        </div>
        <CollapseButton collapsed={collapsed} onToggle={toggle} />
      </div>

      {!collapsed && (
        <>
          <div style={{ marginTop: 10 }}>
            <input
              data-nodrag
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Sök i störningar…"
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 6,
                padding: "6px 10px",
                color: "#fff",
                fontSize: 12,
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
            <FilterChip
              active={activeSeverity === "ALL"}
              label={`Alla (${alerts.length})`}
              color="#8b98ad"
              onClick={() => setActiveSeverity("ALL")}
            />
            {(["SEVERE", "WARNING", "INFO"] as Severity[]).map((s) => {
              const n = sevCounts[s];
              if (n === 0) return null;
              return (
                <FilterChip
                  key={s}
                  active={activeSeverity === s}
                  label={`${SEVERITY_LABEL[s]} (${n})`}
                  color={SEVERITY_COLOR[s]}
                  onClick={() => setActiveSeverity(s)}
                />
              );
            })}
          </div>

          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              overflowY: "auto",
              paddingRight: 4,
              minHeight: 0,
            }}
          >
            {filtered.length === 0 ? (
              <div style={{ fontSize: 12, color: "#6b778c", padding: "12px 0" }}>Inga träffar.</div>
            ) : (
              filtered.map((a) => (
                <AlertRow
                  key={a.id}
                  alert={a}
                  onClickStation={() => a.stationId && setSelectedStation(a.stationId)}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FilterChip({ active, label, color, onClick }: { active: boolean; label: string; color: string; onClick: () => void }) {
  return (
    <button
      data-nodrag
      onClick={onClick}
      style={{
        background: active ? `${color}28` : "transparent",
        border: `1px solid ${active ? `${color}66` : "rgba(255,255,255,0.08)"}`,
        color: active ? "#fff" : "#8b98ad",
        padding: "3px 8px",
        borderRadius: 4,
        cursor: "pointer",
        fontSize: 10,
        fontFamily: "inherit",
        letterSpacing: 0.04,
      }}
    >
      <span style={{
        display: "inline-block",
        width: 6, height: 6, borderRadius: "50%",
        background: color,
        marginRight: 6,
        verticalAlign: "middle",
      }} />
      {label}
    </button>
  );
}

function AlertRow({ alert, onClickStation }: { alert: Alert; onClickStation: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const severity = (alert.severity ?? "UNKNOWN_SEVERITY") as Severity;
  const color = SEVERITY_COLOR[severity];
  const cause = alert.cause ? CAUSE_LABEL[alert.cause] ?? alert.cause : null;
  const hasDetail = !!(alert.description && alert.description.trim() !== (alert.header ?? alert.message ?? "").trim());

  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: 6,
        background: "rgba(255,255,255,0.025)",
        border: `1px solid ${color}33`,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div
        data-nodrag
        style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: hasDetail ? "pointer" : "default" }}
        onClick={() => hasDetail && setExpanded((v) => !v)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: "#fff", lineHeight: 1.35 }}>
            {alert.header || alert.message}
          </div>
          {!expanded && hasDetail && (
            <div style={{ fontSize: 11, color: "#c7cfdc", marginTop: 4, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any }}>
              {alert.description}
            </div>
          )}
          {expanded && alert.description && (
            <div style={{ fontSize: 11, color: "#c7cfdc", marginTop: 4, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
              {alert.description}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            {(alert.lineIds ?? []).map((l) => (
              <span key={l} style={{
                padding: "1px 6px",
                borderRadius: 3,
                background: "rgba(124,196,255,0.1)",
                color: "#7cc4ff",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.04,
              }}>{l}</span>
            ))}
            {cause && (
              <span style={{ fontSize: 10, color: "#8b98ad" }}>{cause}</span>
            )}
            {alert.stationName && alert.stationId && (
              <button
                data-nodrag
                onClick={(e) => {
                  e.stopPropagation();
                  onClickStation();
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#7cc4ff",
                  padding: 0,
                  fontSize: 10,
                  cursor: "pointer",
                  textDecoration: "underline",
                  fontFamily: "inherit",
                }}
              >{alert.stationName}</button>
            )}
            {alert.stationName && !alert.stationId && (
              <span style={{ fontSize: 10, color: "#8b98ad" }}>{alert.stationName}</span>
            )}
            {alert.activeUntil && (
              <span style={{ fontSize: 10, color: "#6b778c", marginLeft: "auto" }}>
                t.o.m. {new Date(alert.activeUntil).toLocaleString("sv-SE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
