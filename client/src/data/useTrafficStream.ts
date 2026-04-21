import { useEffect, useRef } from "react";
import { useAppStore } from "./store";
import type { Network } from "./types";

export function useTrafficStream() {
  const setNetwork = useAppStore((s) => s.setNetwork);
  const applySnapshot = useAppStore((s) => s.applySnapshot);
  const setConnected = useAppStore((s) => s.setConnected);
  const setSource = useAppStore((s) => s.setSource);
  const setRegions = useAppStore((s) => s.setRegions);
  const regionId = useAppStore((s) => s.regionId);
  const setRegionId = useAppStore((s) => s.setRegionId);

  // Fetch the region list once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/regions");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setRegions(data.regions ?? []);
        const allowed = new Set<string>((data.regions ?? []).map((r: { id: string }) => r.id));
        if (!allowed.has(regionId)) {
          setRegionId(data.defaultRegion || (data.regions?.[0]?.id ?? "stockholm"));
        }
      } catch {}
    })();
    return () => { cancelled = true; };
    // Intentionally only runs once — setRegions/setRegionId are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch network for the active region.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/network?region=${encodeURIComponent(regionId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as Network;
        if (!cancelled) setNetwork(data);
      } catch (err) {
        console.error("Failed to load network:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [regionId, setNetwork]);

  // Fetch the extra stop list (bus stops etc.) so search can hit them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stops?region=${encodeURIComponent(regionId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) {
          useAppStore.getState().setExtraStops(data);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [regionId]);

  // Pull the chronic-delay scores on region change and refresh every
  // 2 minutes while the region is active.
  useEffect(() => {
    let cancelled = false;
    const fetchScores = async () => {
      try {
        const res = await fetch(`/api/chronic?region=${encodeURIComponent(regionId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) useAppStore.getState().setChronicScores(data.scores ?? {}, data.max ?? 0);
      } catch {}
    };
    fetchScores();
    const h = window.setInterval(fetchScores, 120_000);
    return () => { cancelled = true; window.clearInterval(h); };
  }, [regionId]);

  // WebSocket: reconnect logic independent of region. When region changes
  // while connected, send a set-region message; don't tear down the socket.
  const wsRef = useRef<WebSocket | null>(null);
  const currentRegionRef = useRef<string>(regionId);

  useEffect(() => {
    let closed = false;
    let reconnectHandle: number | null = null;

    function connect() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${location.host}/stream`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        // React StrictMode mounts each effect twice: the first mount's ws is
        // closed by cleanup, but its async onclose runs *after* the second
        // mount has already installed a fresh ws into wsRef. If we updated
        // wsRef unconditionally we'd null out the live socket. Guard every
        // handler with an identity check so zombie-close callbacks from the
        // previous mount can't trash the current one.
        if (wsRef.current !== ws) return;
        setConnected(true);
        const r = currentRegionRef.current;
        console.info(`[stream] ws open — sending set-region ${r}`);
        ws.send(JSON.stringify({ type: "set-region", region: r }));
      };
      ws.onclose = (ev) => {
        const isCurrent = wsRef.current === ws;
        console.info(`[stream] ws close code=${ev.code} reason=${ev.reason || "-"} clean=${ev.wasClean} current=${isCurrent}`);
        if (!isCurrent) return;
        setConnected(false);
        wsRef.current = null;
        if (!closed) reconnectHandle = window.setTimeout(connect, 1500);
      };
      ws.onerror = (ev) => {
        if (wsRef.current !== ws) return;
        console.warn("[stream] ws error", ev);
        ws.close();
      };
      ws.onmessage = (e) => {
        if (wsRef.current !== ws) return; // ignore zombie-socket messages
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "hello") {
            setSource(msg.source === "trafiklab" ? "trafiklab" : "simulator");
            useAppStore.getState().setAIEnabled(!!msg.aiEnabled);
          } else if (msg.type === "region") {
            // Acknowledge region switch; snapshot follows.
          } else if (msg.type === "snapshot") {
            // Read the current region directly from the store — a React ref
            // is updated inside a useEffect which runs AFTER state change, so
            // there's a race where a freshly-pushed snapshot for the new
            // region can arrive with the ref still holding the old one.
            const state = useAppStore.getState();
            const count = msg.data?.trains?.length ?? 0;
            if (msg.region && msg.region !== state.regionId) {
              console.info(`[stream] drop snapshot for ${msg.region} (current=${state.regionId}) trains=${count}`);
              return;
            }
            if (state.replayActive) return;
            // Only log when the payload content changes appreciably so we
            // don't spam the console at 1 Hz with identical counts.
            if (count !== state.trains.size) {
              console.info(`[stream] apply snapshot ${msg.region} trains=${count}`);
            }
            applySnapshot(msg.data);
          } else if (msg.type === "ai") {
            const { latest, error, regionId: msgRegion } = msg.data ?? {};
            if (msgRegion && msgRegion !== useAppStore.getState().regionId) return;
            useAppStore.getState().setAIAnalysis(latest ?? null, error ?? null);
          }
        } catch (err) {
          console.warn("Bad WS message:", err);
        }
      };
    }

    connect();

    return () => {
      closed = true;
      if (reconnectHandle !== null) clearTimeout(reconnectHandle);
      wsRef.current?.close();
    };
  }, [applySnapshot, setConnected, setSource]);

  // On region change: tell the server to switch subscription.
  useEffect(() => {
    currentRegionRef.current = regionId;
    const ws = wsRef.current;
    const state = ws?.readyState;
    console.info(`[stream] region-change → ${regionId} (ws readyState=${state})`);
    if (ws && state === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "set-region", region: regionId }));
    }
  }, [regionId]);

  // Safety net: if the scene sits empty for >15 s after a region switch, the
  // WS socket has likely gone silent (some network paths don't deliver
  // onclose). Force-reconnect so the server re-pushes data and the client
  // isn't stuck on a dead pipe.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const s = useAppStore.getState();
      if (s.trains.size > 0 || !s.connected || s.replayActive) return;
      const ws = wsRef.current;
      if (!ws) return;
      console.info("[stream] no data after region switch — forcing WS reconnect");
      try { ws.close(); } catch {}
    }, 15_000);
    return () => window.clearTimeout(t);
  }, [regionId]);
}
