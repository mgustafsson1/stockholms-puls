import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAppStore } from "../data/store";

const MODE_BADGE: Record<string, { color: string; label: string }> = {
  subway: { color: "#ffffff", label: "T" },
  rail: { color: "#ff7a1f", label: "J" },
  lightrail: { color: "#b084ff", label: "L" },
  tram: { color: "#f4c430", label: "S" },
  ferry: { color: "#24d4d4", label: "B" },
};

function normalize(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function StationSearch() {
  const network = useAppStore((s) => s.network);
  const setSelected = useAppStore((s) => s.setSelectedStation);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<number | null>(null);

  const suggestions = useMemo(() => {
    if (!network) return [];
    const raw = query.trim();
    if (!raw) return [];
    const q = normalize(raw);
    const seen = new Set<string>();
    const out: { station: typeof network.stations[number]; score: number }[] = [];
    for (const s of network.stations) {
      const name = normalize(s.name);
      const hit = name.indexOf(q);
      if (hit < 0) continue;
      const key = `${s.name}|${s.mode ?? "subway"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const score = hit === 0 ? 0 : hit < 3 ? 1 : 2;
      out.push({ station: s, score });
    }
    out.sort((a, b) => a.score - b.score || a.station.name.localeCompare(b.station.name, "sv"));
    return out.slice(0, 10).map((x) => x.station);
  }, [network, query]);

  useEffect(() => {
    setHighlightedIdx(0);
  }, [query]);

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const inForm = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (e.key === "/" && !inForm) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function pickStation(id: string) {
    setSelected(id);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.min(i + 1, Math.max(0, suggestions.length - 1)));
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const hit = suggestions[highlightedIdx];
      if (hit) pickStation(hit.id);
    } else if (e.key === "Escape") {
      if (query) {
        setQuery("");
      } else {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 12,
        width: 360,
        pointerEvents: "auto",
      }}
    >
      <div
        className="panel"
        style={{
          padding: "6px 8px 6px 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14, color: "#8b98ad" }}>⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            if (blurTimer.current) window.clearTimeout(blurTimer.current);
            blurTimer.current = window.setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={onKeyDown}
          placeholder="Sök station… (/)"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#fff",
            fontSize: 14,
            padding: "6px 0",
            fontFamily: "inherit",
          }}
        />
        {query && (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Rensa"
            style={{
              background: "transparent",
              border: "none",
              color: "#8b98ad",
              cursor: "pointer",
              fontSize: 16,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div
          className="panel"
          style={{
            marginTop: 6,
            padding: 4,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            maxHeight: 360,
            overflowY: "auto",
          }}
        >
          {suggestions.map((s, i) => {
            const badge = MODE_BADGE[s.mode ?? "subway"];
            const active = i === highlightedIdx;
            return (
              <button
                key={`${s.id}-${i}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickStation(s.id);
                }}
                onMouseEnter={() => setHighlightedIdx(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 8,
                  background: active ? "rgba(124,196,255,0.12)" : "transparent",
                  color: "#fff",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 5,
                    background: badge.color,
                    color: "#04060c",
                    fontWeight: 700,
                    fontSize: 11,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {badge.label}
                </span>
                <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.name}
                </span>
                {s.depth > 0 && (
                  <span style={{ fontSize: 10, color: "#8b98ad" }}>{s.depth} m</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
