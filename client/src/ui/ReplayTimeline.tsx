import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../data/store";

// Rate options for the play button. 1× is real-time (1 minute of scrubber
// per minute of wall clock), 16× lets you re-watch a rush hour in a couple
// of minutes.
const RATES = [1, 4, 16, 64];

export function ReplayTimeline() {
  const replayActive = useAppStore((s) => s.replayActive);
  const replayAt = useAppStore((s) => s.replayAt);
  const replayPlaying = useAppStore((s) => s.replayPlaying);
  const replayRate = useAppStore((s) => s.replayRate);
  const replayRange = useAppStore((s) => s.replayRange);
  const regionId = useAppStore((s) => s.regionId);
  const setReplayActive = useAppStore((s) => s.setReplayActive);
  const setReplayAt = useAppStore((s) => s.setReplayAt);
  const setReplayPlaying = useAppStore((s) => s.setReplayPlaying);
  const setReplayRate = useAppStore((s) => s.setReplayRate);
  const setReplayRange = useAppStore((s) => s.setReplayRange);
  const applySnapshot = useAppStore((s) => s.applySnapshot);

  // Pull the history bounds every 20 s so the scrubber grows as new
  // snapshots are buffered on the server.
  useEffect(() => {
    if (!replayActive) return;
    let cancelled = false;
    const fetchRange = async () => {
      try {
        const r = await fetch(`/api/history/range?region=${encodeURIComponent(regionId)}`);
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && j?.count > 0) setReplayRange({ from: j.from, to: j.to, intervalMs: j.intervalMs });
      } catch {}
    };
    fetchRange();
    const h = window.setInterval(fetchRange, 20_000);
    return () => { cancelled = true; window.clearInterval(h); };
  }, [replayActive, regionId, setReplayRange]);

  // Fetch the snapshot at the playhead whenever it moves and dispatch it
  // into the scene store. Debounced via a cancel-token so a rapid scrub
  // doesn't stack a dozen in-flight requests.
  const inflightId = useRef(0);
  useEffect(() => {
    if (!replayActive || !replayRange || !replayAt) return;
    const myId = ++inflightId.current;
    (async () => {
      try {
        const r = await fetch(`/api/history/at?region=${encodeURIComponent(regionId)}&t=${replayAt}`);
        if (!r.ok) return;
        const snap = await r.json();
        if (myId !== inflightId.current) return;
        applySnapshot(snap);
      } catch {}
    })();
  }, [replayActive, replayAt, regionId, replayRange, applySnapshot]);

  // Play loop: while playing, advance the playhead by real-seconds × rate
  // × the recorder's sample interval (so 1× ≈ wall-clock speed).
  useEffect(() => {
    if (!replayActive || !replayPlaying || !replayRange) return;
    let raf = 0;
    let lastT = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = (now - lastT) / 1000;
      lastT = now;
      const { replayAt: current, replayRange: range, replayRate: rate, replayPlaying: stillPlaying } = useAppStore.getState();
      if (!stillPlaying || !range) return;
      const next = Math.min(range.to, current + dt * 1000 * rate);
      if (next !== current) setReplayAt(next);
      if (next >= range.to) {
        setReplayPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [replayActive, replayPlaying, replayRange, setReplayAt, setReplayPlaying]);

  if (!replayActive) {
    return (
      <button
        className="panel"
        onClick={async () => {
          try {
            const r = await fetch(`/api/history/range?region=${encodeURIComponent(regionId)}`);
            if (!r.ok) return;
            const j = await r.json();
            if (!j?.count) {
              alert("Ingen historik finns ännu — servern har precis startats. Försök igen om en stund.");
              return;
            }
            setReplayRange({ from: j.from, to: j.to, intervalMs: j.intervalMs });
            setReplayAt(j.to);
            setReplayActive(true);
          } catch {}
        }}
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 11,
          padding: "8px 14px",
          fontSize: 11,
          letterSpacing: 0.14,
          textTransform: "uppercase",
          color: "#c7cfdc",
          cursor: "pointer",
          pointerEvents: "auto",
        }}
      >Historik</button>
    );
  }

  return (
    <div
      className="panel"
      style={{
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 13,
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        width: "min(720px, calc(100vw - 80px))",
        pointerEvents: "auto",
      }}
    >
      <button
        onClick={() => setReplayPlaying(!replayPlaying)}
        style={{
          background: replayPlaying ? "rgba(124,196,255,0.18)" : "transparent",
          border: `1px solid ${replayPlaying ? "rgba(124,196,255,0.45)" : "rgba(255,255,255,0.14)"}`,
          color: "#fff",
          width: 34, height: 34, borderRadius: 8,
          cursor: "pointer",
          fontSize: 14,
          fontFamily: "inherit",
        }}
        aria-label={replayPlaying ? "Pausa" : "Spela"}
      >{replayPlaying ? "❚❚" : "▶"}</button>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <TimelineScrubber />
        <TimelineLabels />
      </div>

      <RateSelector rate={replayRate} onChange={setReplayRate} />

      <button
        onClick={() => {
          if (replayRange) setReplayAt(replayRange.to);
          setReplayPlaying(false);
        }}
        style={{
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.14)",
          color: "#c7cfdc",
          padding: "6px 10px",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 10.5,
          letterSpacing: 0.1,
          textTransform: "uppercase",
          fontFamily: "inherit",
        }}
      >Senaste</button>

      <button
        onClick={() => setReplayActive(false)}
        style={{
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.14)",
          color: "#8b98ad",
          width: 28, height: 28, borderRadius: 6,
          cursor: "pointer",
          fontSize: 14,
        }}
        aria-label="Stäng replay"
      >×</button>
    </div>
  );
}

function TimelineScrubber() {
  const replayRange = useAppStore((s) => s.replayRange);
  const replayAt = useAppStore((s) => s.replayAt);
  const setReplayAt = useAppStore((s) => s.setReplayAt);
  const setReplayPlaying = useAppStore((s) => s.setReplayPlaying);
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  if (!replayRange || replayRange.to <= replayRange.from) {
    return <div style={{ height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3 }} />;
  }

  const span = replayRange.to - replayRange.from;
  const frac = Math.max(0, Math.min(1, (replayAt - replayRange.from) / span));

  const commit = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const t = replayRange.from + (x / rect.width) * span;
    setReplayAt(t);
  };

  return (
    <div
      ref={trackRef}
      style={{
        position: "relative",
        height: 18,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
      }}
      onMouseDown={(e) => {
        setDragging(true);
        setReplayPlaying(false);
        commit(e.clientX);
      }}
      onMouseMove={(e) => { if (dragging) commit(e.clientX); }}
      onMouseUp={() => setDragging(false)}
      onMouseLeave={() => setDragging(false)}
    >
      <div style={{
        position: "absolute", left: 0, right: 0, top: 8, height: 4,
        background: "rgba(255,255,255,0.06)",
        borderRadius: 2,
      }} />
      <div style={{
        position: "absolute", left: 0, top: 8, height: 4,
        width: `${frac * 100}%`,
        background: "linear-gradient(90deg, rgba(124,196,255,0.45), rgba(124,196,255,0.9))",
        borderRadius: 2,
      }} />
      <div style={{
        position: "absolute",
        left: `calc(${frac * 100}% - 7px)`,
        top: 2,
        width: 14, height: 14, borderRadius: "50%",
        background: "#fff",
        boxShadow: "0 0 12px rgba(124,196,255,0.6)",
      }} />
    </div>
  );
}

function TimelineLabels() {
  const replayRange = useAppStore((s) => s.replayRange);
  const replayAt = useAppStore((s) => s.replayAt);
  const fmt = (t: number) => new Date(t).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  if (!replayRange) return <div style={{ fontSize: 10, color: "#6b778c" }}>Samlar historik…</div>;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8b98ad", fontFamily: "JetBrains Mono, monospace", fontVariantNumeric: "tabular-nums" }}>
      <span>{fmt(replayRange.from)}</span>
      <span style={{ color: "#fff", fontWeight: 600 }}>{fmt(replayAt || replayRange.to)}</span>
      <span>{fmt(replayRange.to)}</span>
    </div>
  );
}

function RateSelector({ rate, onChange }: { rate: number; onChange: (r: number) => void }) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {RATES.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          style={{
            background: rate === r ? "rgba(124,196,255,0.18)" : "transparent",
            border: `1px solid ${rate === r ? "rgba(124,196,255,0.45)" : "rgba(255,255,255,0.08)"}`,
            color: rate === r ? "#fff" : "#8b98ad",
            padding: "4px 6px",
            fontSize: 10,
            borderRadius: 4,
            cursor: "pointer",
            fontFamily: "inherit",
            minWidth: 26,
          }}
        >{r}×</button>
      ))}
    </div>
  );
}
