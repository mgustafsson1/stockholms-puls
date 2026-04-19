import { create } from "zustand";
import type { AIAnalysis, Alert, CameraMode, Network, Snapshot, Train } from "./types";

const HIDDEN_LINES_KEY = "sl:hidden-line-ids";

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
  regions: { id: string; label: string }[];
  regionId: string;

  setNetwork: (n: Network) => void;
  setHiddenLineIds: (ids: Set<string>) => void;
  toggleLineGroup: (lineIds: string[]) => void;
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
  regions: [],
  regionId: (typeof localStorage !== "undefined" && localStorage.getItem("sl:region")) || "stockholm",

  setNetwork: (n) => set({ network: n }),
  setRegions: (list) => set({ regions: list }),
  setRegionId: (id) => {
    try { localStorage.setItem("sl:region", id); } catch {}
    set({ regionId: id, selectedTrainId: null, selectedStationId: null, followTrainId: null, trains: new Map() });
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
}));
