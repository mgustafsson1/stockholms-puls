import { create } from "zustand";
import type { AIAnalysis, Alert, CameraMode, Network, Snapshot, Train } from "./types";

const HIDDEN_LINES_KEY = "sl:hidden-line-ids";
const HIDDEN_MODES_KEY = "sl:hidden-modes:v2";

function loadHiddenLineIds(): Set<string> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(HIDDEN_LINES_KEY) : null;
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {}
  return new Set();
}

function saveHiddenLineIds(ids: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_LINES_KEY, JSON.stringify(Array.from(ids)));
  } catch {}
}

function loadHiddenModes(): Set<string> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(HIDDEN_MODES_KEY) : null;
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === "string"));
    }
  } catch {}
  return new Set();
}

function saveHiddenModes(modes: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_MODES_KEY, JSON.stringify(Array.from(modes)));
  } catch {}
}

export interface ExtraStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface FocusPoint {
  lat: number;
  lon: number;
  label: string;
  at: number; // monotonic counter so repeated picks retrigger the camera
}

interface AppState {
  network: Network | null;
  trains: Map<string, Train>;
  alerts: Alert[];
  lastSnapshotAt: number;
  connected: boolean;
  source: "simulator" | "trafiklab" | "unknown";
  cameraMode: CameraMode;
  followTrainId: string | null;
  hoveredStationId: string | null;
  hoveredTrainId: string | null;
  selectedTrainId: string | null;
  selectedStationId: string | null;
  showLabels: boolean;
  aiAnalysis: AIAnalysis | null;
  aiError: string | null;
  aiEnabled: boolean;
  hiddenLineIds: Set<string>;
  hiddenModes: Set<string>;
  showBasemap: boolean;
  regions: { id: string; label: string }[];
  regionId: string;
  extraStops: ExtraStop[];
  focusPoint: FocusPoint | null;
  // Per-station "chronic delay" score (0..max) with the region's current
  // max so the UI can normalise without recomputing it.
  chronicScores: Record<string, number>;
  chronicMax: number;
  // 3D buildings layer configuration.
  showBuildings: boolean;
  buildingsOpacity: number;      // 0..1
  buildingsHeightScale: number;  // multiplier applied to OSM heights
  // Replay controls. When `replayActive` is true we stop applying live WS
  // snapshots and instead drive `trains`/`alerts` from the server's
  // /api/history/at endpoint at `replayAt` (ms since epoch). `replayRate`
  // multiplies wall-clock time while the user is in "play" mode.
  replayActive: boolean;
  replayAt: number;
  replayPlaying: boolean;
  replayRate: number;
  replayRange: { from: number; to: number; intervalMs: number } | null;

  setNetwork: (n: Network) => void;
  setHiddenLineIds: (ids: Set<string>) => void;
  toggleLineGroup: (lineIds: string[]) => void;
  toggleMode: (mode: string) => void;
  setShowBasemap: (v: boolean) => void;
  setRegions: (list: { id: string; label: string }[]) => void;
  setRegionId: (id: string) => void;
  applySnapshot: (snap: Snapshot) => void;
  setConnected: (v: boolean) => void;
  setSource: (s: "simulator" | "trafiklab" | "unknown") => void;
  setCameraMode: (m: CameraMode) => void;
  setFollowTrain: (id: string | null) => void;
  setHoveredStation: (id: string | null) => void;
  setHoveredTrain: (id: string | null) => void;
  setSelectedTrain: (id: string | null) => void;
  setSelectedStation: (id: string | null) => void;
  setShowLabels: (v: boolean) => void;
  setAIAnalysis: (a: AIAnalysis | null, err: string | null) => void;
  setAIEnabled: (v: boolean) => void;
  setExtraStops: (stops: ExtraStop[]) => void;
  focusOn: (lat: number, lon: number, label: string) => void;
  setReplayActive: (v: boolean) => void;
  setReplayAt: (t: number) => void;
  setReplayPlaying: (v: boolean) => void;
  setReplayRate: (r: number) => void;
  setReplayRange: (r: { from: number; to: number; intervalMs: number } | null) => void;
  setChronicScores: (scores: Record<string, number>, max: number) => void;
  setShowBuildings: (v: boolean) => void;
  setBuildingsOpacity: (v: number) => void;
  setBuildingsHeightScale: (v: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  network: null,
  trains: new Map(),
  alerts: [],
  lastSnapshotAt: 0,
  connected: false,
  source: "unknown",
  cameraMode: "overview",
  followTrainId: null,
  hoveredStationId: null,
  hoveredTrainId: null,
  selectedTrainId: null,
  selectedStationId: null,
  showLabels: true,
  aiAnalysis: null,
  aiError: null,
  aiEnabled: false,
  hiddenLineIds: loadHiddenLineIds(),
  hiddenModes: loadHiddenModes(),
  showBasemap: (() => {
    try { return (typeof localStorage !== "undefined" ? localStorage.getItem("sl:basemap") : null) === "true"; } catch { return false; }
  })(),
  regions: [],
  regionId: (typeof localStorage !== "undefined" && localStorage.getItem("sl:region")) || "stockholm",
  extraStops: [],
  focusPoint: null,
  replayActive: false,
  replayAt: 0,
  replayPlaying: false,
  replayRate: 4,
  replayRange: null,
  chronicScores: {},
  chronicMax: 0,
  showBuildings: (() => {
    try { return (typeof localStorage !== "undefined" ? localStorage.getItem("sl:buildings") : null) !== "false"; } catch { return true; }
  })(),
  buildingsOpacity: (() => {
    try {
      const v = typeof localStorage !== "undefined" ? parseFloat(localStorage.getItem("sl:buildings-opacity") ?? "") : NaN;
      return Number.isFinite(v) ? v : 0.65;
    } catch { return 0.65; }
  })(),
  buildingsHeightScale: (() => {
    try {
      const v = typeof localStorage !== "undefined" ? parseFloat(localStorage.getItem("sl:buildings-height") ?? "") : NaN;
      return Number.isFinite(v) ? v : 1;
    } catch { return 1; }
  })(),

  setNetwork: (n) => set({ network: n }),
  setRegions: (list) => set({ regions: list }),
  setRegionId: (id) => {
    try { localStorage.setItem("sl:region", id); } catch {}
    set({
      regionId: id,
      selectedTrainId: null,
      selectedStationId: null,
      followTrainId: null,
      trains: new Map(),
      // Clear the previous region's AI analysis so the panel doesn't briefly
      // show stale content for the wrong region while we wait for a push.
      aiAnalysis: null,
      aiError: null,
      // Stop search from showing last region's bus stops until the new list
      // arrives.
      extraStops: [],
      // Drop out of replay when we switch region — the playhead only makes
      // sense relative to one region's history buffer.
      replayActive: false,
      replayPlaying: false,
      replayRange: null,
      replayAt: 0,
      chronicScores: {},
      chronicMax: 0,
    });
  },
  setHiddenLineIds: (ids) => {
    saveHiddenLineIds(ids);
    set({ hiddenLineIds: new Set(ids) });
  },
  toggleLineGroup: (lineIds) => {
    const current = useAppStore.getState().hiddenLineIds;
    const next = new Set(current);
    const allHidden = lineIds.every((id) => current.has(id));
    if (allHidden) {
      for (const id of lineIds) next.delete(id);
    } else {
      for (const id of lineIds) next.add(id);
    }
    saveHiddenLineIds(next);
    set({ hiddenLineIds: next });
  },
  toggleMode: (mode) => {
    const current = useAppStore.getState().hiddenModes;
    const next = new Set(current);
    if (next.has(mode)) next.delete(mode); else next.add(mode);
    saveHiddenModes(next);
    set({ hiddenModes: next });
  },
  setShowBasemap: (v) => {
    try { localStorage.setItem("sl:basemap", String(v)); } catch {}
    set({ showBasemap: v });
  },
  applySnapshot: (snap) => {
    const trains = new Map<string, Train>();
    for (const t of snap.trains) trains.set(t.id, t);
    set({ trains, alerts: snap.alerts, lastSnapshotAt: snap.t });
  },
  setConnected: (v) => set({ connected: v }),
  setSource: (s) => set({ source: s }),
  setCameraMode: (m) => set({ cameraMode: m, followTrainId: m === "follow" ? useAppStore.getState().followTrainId : null }),
  setFollowTrain: (id) => set({ followTrainId: id, cameraMode: id ? "follow" : useAppStore.getState().cameraMode }),
  setHoveredStation: (id) => set({ hoveredStationId: id }),
  setHoveredTrain: (id) => set({ hoveredTrainId: id }),
  setSelectedTrain: (id) => set({ selectedTrainId: id, selectedStationId: id ? null : useAppStore.getState().selectedStationId }),
  setSelectedStation: (id) => set({ selectedStationId: id, selectedTrainId: id ? null : useAppStore.getState().selectedTrainId }),
  setShowLabels: (v) => set({ showLabels: v }),
  setAIAnalysis: (a, err) => set({ aiAnalysis: a, aiError: err }),
  setAIEnabled: (v) => set({ aiEnabled: v }),
  setExtraStops: (stops) => set({ extraStops: stops }),
  focusOn: (lat, lon, label) => set({ focusPoint: { lat, lon, label, at: Date.now() } }),
  setReplayActive: (v) => set({ replayActive: v, replayPlaying: false }),
  setReplayAt: (t) => set({ replayAt: t }),
  setReplayPlaying: (v) => set({ replayPlaying: v }),
  setReplayRate: (r) => set({ replayRate: r }),
  setReplayRange: (r) => set({ replayRange: r }),
  setChronicScores: (scores, max) => set({ chronicScores: scores, chronicMax: max }),
  setShowBuildings: (v) => {
    try { localStorage.setItem("sl:buildings", String(v)); } catch {}
    set({ showBuildings: v });
  },
  setBuildingsOpacity: (v) => {
    const clamped = Math.max(0.1, Math.min(1, v));
    try { localStorage.setItem("sl:buildings-opacity", String(clamped)); } catch {}
    set({ buildingsOpacity: clamped });
  },
  setBuildingsHeightScale: (v) => {
    const clamped = Math.max(0.25, Math.min(4, v));
    try { localStorage.setItem("sl:buildings-height", String(clamped)); } catch {}
    set({ buildingsHeightScale: clamped });
  },
}));
