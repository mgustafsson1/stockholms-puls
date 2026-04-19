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
        setConnected(true);
        ws.send(JSON.stringify({ type: "set-region", region: currentRegionRef.current }));
      };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!closed) reconnectHandle = window.setTimeout(connect, 1500);
      };
      ws.onerror = () => { ws.close(); };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "hello") {
            setSource(msg.source === "trafiklab" ? "trafiklab" : "simulator");
            useAppStore.getState().setAIEnabled(!!msg.aiEnabled);
          } else if (msg.type === "region") {
            // Acknowledge region switch; snapshot follows.
          } else if (msg.type === "snapshot") {
            // Ignore snapshots from a region we've since switched away from.
            if (msg.region && msg.region !== currentRegionRef.current) return;
            applySnapshot(msg.data);
          } else if (msg.type === "ai") {
            const { latest, error } = msg.data ?? {};
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
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "set-region", region: regionId }));
    }
  }, [regionId]);
}
