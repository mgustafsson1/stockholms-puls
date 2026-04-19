import { useEffect, useMemo, useState } from "react";
import { useDraggable } from "./useDraggable";
import { useCollapsible, CollapseButton } from "./useCollapsible";
import { useAppStore } from "../data/store";

type Metric = "avgDelay" | "delayed" | "stopped" | "punctuality";

interface Sample {
  t: number;
  byGroup: Record<string, {
    total: number;
    ok: number;
    delayed: number;
    stopped: number;
    avgDelay: number;
    punctuality: number;
  }>;
}

interface GroupDef {
  id: string;
  label: string;
  color: string;
  mode?: string;
}

interface TrendsResponse {
  intervalMs: number;
  maxSamples: number;
  groups?: GroupDef[];
  samples: Sample[];
}

const METRICS: { id: Metric; label: string; unit: string }[] = [
  { id: "avgDelay",    label: "Snittförsening",   unit: "s" },
  { id: "delayed",     label: "Antal försenade",  unit: "" },
  { id: "stopped",     label: "Antal stopp",      unit: "" },
  { id: "punctuality", label: "Punktlighet",      unit: "%" },
];

export function TrendPanel() {
  const drag = useDraggable({ storageKey: "trend-panel", defaultAnchor: { right: 20, top: 180 } });
  const { collapsed, toggle } = useCollapsible("trend-panel");
  const regionId = useAppStore((s) => s.regionId);
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [metric, setMetric] = useState<Metric>("avgDelay");

  useEffect(() => {
    let cancelled = false;
    let handle: number | null = null;
    setData(null);

    async function fetchData() {
      try {
        const res = await fetch(`/api/trends?region=${encodeURIComponent(regionId)}`);
        if (!res.ok) return;
        const json = (await res.json()) as TrendsResponse;
        if (!cancelled) setData(json);
      } catch {}
    }

    fetchData();
    handle = window.setInterval(fetchData, 30_000);
    return () => {
      cancelled = true;
      if (handle) clearInterval(handle);
    };
  }, [regionId]);

  // Only show groups that have at least one non-zero data point in the current
  // window – otherwise regions with a handful of lines render a forest of dead
  // rows.
  const groups = useMemo<GroupDef[]>(() => {
    if (!data?.groups?.length) return [];
    return data.groups.filter((g) => data.samples.some((s) => {
      const gd = s.byGroup[g.id];
      return gd && gd.total > 0;
    }));
  }, [data]);

  const series = useMemo(() => {
    if (!data) return new Map<string, number[]>();
    const out = new Map<string, number[]>();
    for (const g of groups) {
      const arr: number[] = [];
      for (const s of data.samples) {
        const gd = s.byGroup[g.id];
        if (!gd) {
          arr.push(0);
          continue;
        }
        let v = 0;
        if (metric === "avgDelay") v = gd.avgDelay;
        else if (metric === "delayed") v = gd.delayed;
        else if (metric === "stopped") v = gd.stopped;
        else if (metric === "punctuality") v = Math.round(gd.punctuality * 100);
        arr.push(v);
      }
      out.set(g.id, arr);
    }
    return out;
  }, [data, metric, groups]);

  const spanMinutes = data ? Math.round((data.samples.length * data.intervalMs) / 60_000) : 0;
  const metricMeta = METRICS.find((m) => m.id === metric)!;

  return (
    <div
      ref={drag.ref as any}
      className="panel"
      style={{
        minWidth: 300,
        maxWidth: 320,
        pointerEvents: "auto",
        zIndex: 7,
        ...drag.style,
      }}
      {...drag.handlers}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: "#8b98ad", letterSpacing: 0.18, textTransform: "uppercase" }}>Trender</div>
          <div style={{ fontSize: 12.5, color: "#c7cfdc", marginTop: 2 }}>
            {metricMeta.label} · {spanMinutes > 0 ? `senaste ${spanMinutes} min` : "samlar…"}
          </div>
        </div>
        <CollapseButton collapsed={collapsed} onToggle={toggle} />
      </div>

      {!collapsed && (
        <>
          <div style={{ display: "flex", gap: 4, marginTop: 10, flexWrap: "wrap" }}>
            {METRICS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMetric(m.id)}
                style={{
                  background: metric === m.id ? "rgba(124,196,255,0.16)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${metric === m.id ? "rgba(124,196,255,0.45)" : "rgba(255,255,255,0.06)"}`,
                  color: metric === m.id ? "#fff" : "#8b98ad",
                  padding: "4px 8px",
                  fontSize: 10.5,
                  borderRadius: 6,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: 0.04,
                }}
              >{m.label}</button>
            ))}
          </div>

          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto", paddingRight: 4 }}>
            {groups.length === 0 && data && data.samples.length > 0 && (
              <div style={{ fontSize: 11, color: "#6b778c" }}>
                Ingen aktiv trafik i mätfönstret än.
              </div>
            )}
            {groups.map((g) => {
              const arr = series.get(g.id) ?? [];
              const hasData = arr.some((v) => v > 0);
              const latest = arr.length ? arr[arr.length - 1] : 0;
              return (
                <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: g.color, flexShrink: 0, boxShadow: `0 0 6px ${g.color}` }} />
                  <span style={{ fontSize: 10.5, color: "#c7cfdc", width: 110, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.label}</span>
                  <div style={{ flex: 1 }}>
                    <Sparkline data={arr} color={g.color} width={110} height={22} />
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: hasData ? "#fff" : "#6b778c",
                      fontFamily: "JetBrains Mono, monospace",
                      fontVariantNumeric: "tabular-nums",
                      minWidth: 42,
                      textAlign: "right",
                    }}
                  >{hasData ? `${latest}${metricMeta.unit}` : "—"}</span>
                </div>
              );
            })}
          </div>

          {(!data || data.samples.length === 0) && (
            <div style={{ fontSize: 11, color: "#6b778c", marginTop: 10 }}>
              Samlar data… (varje {data?.intervalMs ? Math.round(data.intervalMs / 1000) : 30}s)
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Sparkline({ data, color, width = 110, height = 22 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return <svg width={width} height={height} />;
  const min = 0;
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / (max - min)) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = data[data.length - 1];
  const lastY = height - ((last - min) / (max - min)) * (height - 2) - 1;
  const areaPts = `0,${height} ${pts.join(" ")} ${width},${height}`;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`spark-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#spark-${color.replace("#", "")})`} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={lastY} r={1.8} fill={color} />
    </svg>
  );
}
