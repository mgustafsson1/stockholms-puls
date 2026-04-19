import { useMemo } from "react";
import { useAppStore } from "../data/store";
import { useDraggable } from "./useDraggable";
import { useCollapsible, CollapseButton } from "./useCollapsible";

const MOOD_COLOR: Record<string, string> = {
  calm: "#4bd582",
  watch: "#ffc04a",
  stressed: "#ff6a6a",
};

const MOOD_LABEL: Record<string, string> = {
  calm: "Lugnt",
  watch: "Vaksamt",
  stressed: "Ansträngt",
};

export function AIPanel() {
  const analysis = useAppStore((s) => s.aiAnalysis);
  const error = useAppStore((s) => s.aiError);
  const enabled = useAppStore((s) => s.aiEnabled);
  const drag = useDraggable({ storageKey: "ai-panel", defaultAnchor: { left: 20, top: 190 } });
  const { collapsed, toggle } = useCollapsible("ai-panel");

  const ageLabel = useMemo(() => {
    if (!analysis) return "—";
    const age = Math.max(0, Math.floor((Date.now() - analysis.createdAt) / 1000));
    if (age < 60) return `${age}s`;
    return `${Math.floor(age / 60)}m ${age % 60}s`;
  }, [analysis]);

  if (!enabled) {
    return (
      <div
        ref={drag.ref as any}
        className="panel"
        style={{
          maxWidth: 320,
          pointerEvents: "auto",
          opacity: 0.75,
          ...drag.style,
        }}
        {...drag.handlers}
      >
        <div style={{ fontSize: 10, letterSpacing: 0.18, textTransform: "uppercase", color: "#8b98ad", marginBottom: 6 }}>
          AI-analys
        </div>
        <div style={{ fontSize: 12, color: "#c7cfdc", lineHeight: 1.4 }}>
          Inaktiv — sätt <code style={{ fontFamily: "JetBrains Mono, monospace", color: "#ffc04a" }}>OPENROUTER_KEY</code> i miljön och starta om servern för att aktivera.
        </div>
      </div>
    );
  }

  const mood = analysis?.mood ?? "watch";
  const moodColor = MOOD_COLOR[mood];

  return (
    <div
      ref={drag.ref as any}
      className="panel"
      style={{
        maxWidth: 340,
        pointerEvents: "auto",
        borderColor: `${moodColor}40`,
        ...drag.style,
      }}
      {...drag.handlers}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ position: "relative", width: 28, height: 28 }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${moodColor}cc 0%, transparent 70%)`,
              animation: "pulse 1.8s ease-in-out infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 8,
              borderRadius: "50%",
              background: moodColor,
              boxShadow: `0 0 10px ${moodColor}`,
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "#8b98ad", letterSpacing: 0.18, textTransform: "uppercase" }}>
            AI-analys · {analysis?.model?.split("/").pop()}
          </div>
          <div style={{ fontSize: 11.5, color: moodColor, fontWeight: 600, marginTop: 2 }}>
            {MOOD_LABEL[mood] ?? "—"}{analysis ? ` · uppdaterad för ${ageLabel} sedan` : ""}
          </div>
        </div>
        <CollapseButton collapsed={collapsed} onToggle={toggle} />
      </div>

      {!collapsed && !analysis && !error && (
        <div style={{ marginTop: 12, fontSize: 12, color: "#8b98ad" }}>
          Väntar på första analysen…
        </div>
      )}

      {!collapsed && analysis && (
        <>
          <div style={{ marginTop: 14, fontSize: 13.5, color: "#fff", lineHeight: 1.45, fontWeight: 500 }}>
            {analysis.summary}
          </div>

          {analysis.observations.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 10, color: "#8b98ad", letterSpacing: 0.18, textTransform: "uppercase", marginBottom: 6 }}>
                Observationer
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {analysis.observations.map((o, i) => (
                  <li key={i} style={{ fontSize: 12, color: "#c7cfdc", lineHeight: 1.4, paddingLeft: 14, position: "relative" }}>
                    <span style={{ position: "absolute", left: 0, top: 6, width: 4, height: 4, borderRadius: "50%", background: moodColor }} />
                    {o}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.patterns.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 10, color: "#8b98ad", letterSpacing: 0.18, textTransform: "uppercase", marginBottom: 6 }}>
                Mönster
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {analysis.patterns.map((p, i) => (
                  <li key={i} style={{ fontSize: 12, color: "#8fb3e2", lineHeight: 1.4, fontStyle: "italic" }}>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {!collapsed && error && (
        <div style={{ marginTop: 12, fontSize: 11, color: "#ff9090", fontFamily: "JetBrains Mono, monospace" }}>
          fel: {error.slice(0, 140)}
        </div>
      )}
    </div>
  );
}
