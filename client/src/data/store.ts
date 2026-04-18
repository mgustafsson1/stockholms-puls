import { create } from "zustand";
import type { AIAnalysis, Alert, CameraMode, Network, Snapshot, Train } from "./types";

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

  setNetwork: (n: Network) => void;
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

  setNetwork: (n) => set({ network: n }),
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
