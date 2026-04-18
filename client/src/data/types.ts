export type LineGroup = "red" | "green" | "blue";

export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  depth: number;
  lines: LineGroup[];
}

export interface Line {
  id: string;
  name: string;
  color: string;
  line: LineGroup;
  stations: string[];
}

export interface Network {
  origin: { lat: number; lon: number; label: string };
  stations: Station[];
  lines: Line[];
}

export interface Train {
  id: string;
  lineId: string;
  lineGroup: LineGroup;
  color: string;
  status: "ok" | "delayed" | "stopped";
  delay: number;
  direction: 1 | -1;
  from: string;
  to: string;
  progress: number;
  atStation: boolean;
  lat: number;
  lon: number;
  depth: number;
}

export interface Alert {
  id: string;
  stationId: string;
  stationName: string;
  message: string;
  createdAt: number;
  durationMs: number;
}

export interface Snapshot {
  t: number;
  trains: Train[];
  alerts: Alert[];
}

export type CameraMode = "overview" | "cross-section" | "follow" | "anomaly";

export interface AIAnalysis {
  createdAt: number;
  elapsedMs: number;
  model: string;
  snapshotTime: number;
  summary: string;
  observations: string[];
  patterns: string[];
  mood: "calm" | "watch" | "stressed";
}
