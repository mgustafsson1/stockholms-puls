export type Mode = "subway" | "rail" | "lightrail" | "tram" | "ferry" | "bus";
export type LineGroup = string;

export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  depth: number;
  mode?: Mode;
  lines?: string[];
}

export interface Line {
  id: string;
  name: string;
  color: string;
  line: string;
  mode?: Mode;
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
  lineGroup: string;
  mode?: Mode;
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
  // Optional live-feed extras (mostly useful for buses, where we don't have
  // route/segment metadata of our own).
  routeId?: string;
  vehicleLabel?: string;
  licensePlate?: string;
  speed?: number;          // m/s as reported by GTFS-RT
  bearing?: number;        // degrees, 0 = north
  occupancy?: string;      // GTFS-RT OccupancyStatus enum name
  currentStatus?: string;  // IN_TRANSIT_TO, STOPPED_AT, INCOMING_AT
  feedTimestamp?: number;  // ms since epoch, from VehiclePosition.timestamp
  // From the static GTFS trip map (joined at ingestion).
  routeLong?: string;      // route_long_name, e.g. "Radiohuset - Gullmarsplan"
  headsign?: string;       // trip_headsign (often empty in GTFS Sweden)
  agency?: string;         // agency_name, e.g. "Skånetrafiken"
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
