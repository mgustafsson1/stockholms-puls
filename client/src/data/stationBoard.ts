import type { Network, Station, Train } from "./types";

const TRAIN_SPEED_MPS = 14;
const DWELL_SECONDS = 25;
const EARTH_R = 6371000;

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

function segDur(a: Station, b: Station) {
  const dist = haversine(a, b);
  return Math.max(30, dist / TRAIN_SPEED_MPS);
}

export interface BoardEntry {
  trainId: string;
  lineId: string;
  color: string;
  status: "ok" | "delayed" | "stopped";
  delay: number;
  terminusId: string;
  terminusName: string;
  etaSeconds: number;
  via: string | null;
  atStation: boolean;
}

export function computeStationBoard(
  stationId: string,
  trains: Iterable<Train>,
  network: Network
): BoardEntry[] {
  const byId = new Map(network.stations.map((s) => [s.id, s]));
  const target = byId.get(stationId);
  if (!target) return [];

  const entries: BoardEntry[] = [];

  for (const t of trains) {
    const line = network.lines.find((l) => l.id === t.lineId);
    if (!line) continue;
    const targetIdx = line.stations.indexOf(stationId);
    if (targetIdx === -1) continue;

    const fromIdx = line.stations.indexOf(t.from);
    const toIdx = line.stations.indexOf(t.to);
    if (fromIdx === -1) continue;

    const dir = t.direction;

    // If the train is already at the target station (dwelling), ETA = 0
    if (t.from === stationId && t.atStation) {
      const terminusIdx = dir === 1 ? line.stations.length - 1 : 0;
      const terminusId = line.stations[terminusIdx];
      const terminus = byId.get(terminusId);
      entries.push({
        trainId: t.id,
        lineId: t.lineId,
        color: t.color,
        status: t.status,
        delay: t.delay,
        terminusId,
        terminusName: terminus?.name ?? terminusId,
        etaSeconds: 0,
        via: null,
        atStation: true,
      });
      continue;
    }

    // Check if the target is ahead along the current direction
    // The train is on segment [fromIdx -> toIdx] (toIdx = fromIdx + dir)
    // It will visit toIdx, then toIdx + dir, etc. Target must be reachable.
    const reachable =
      (dir === 1 && targetIdx >= toIdx) ||
      (dir === -1 && targetIdx <= toIdx);
    if (!reachable) continue;
    if (toIdx === -1) continue;

    const fromStation = byId.get(t.from);
    const toStation = byId.get(t.to);
    if (!fromStation || !toStation) continue;

    // Time to reach end of current segment
    const currentSegDur = segDur(fromStation, toStation);
    let eta = (1 - t.progress) * currentSegDur;

    // Additional segments up to target
    let idx = toIdx;
    while (idx !== targetIdx) {
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= line.stations.length) break;
      eta += DWELL_SECONDS;
      const s1 = byId.get(line.stations[idx]);
      const s2 = byId.get(line.stations[nextIdx]);
      if (s1 && s2) eta += segDur(s1, s2);
      idx = nextIdx;
    }

    if (idx !== targetIdx) continue;

    eta += t.delay;

    const terminusIdx = dir === 1 ? line.stations.length - 1 : 0;
    const terminusId = line.stations[terminusIdx];
    const terminus = byId.get(terminusId);

    // via hint: next stop or major stop along the way
    const viaId = line.stations[targetIdx + dir];
    const via = byId.get(viaId ?? "")?.name ?? null;

    entries.push({
      trainId: t.id,
      lineId: t.lineId,
      color: t.color,
      status: t.status,
      delay: t.delay,
      terminusId,
      terminusName: terminus?.name ?? terminusId,
      etaSeconds: Math.max(0, eta),
      via,
      atStation: false,
    });
  }

  entries.sort((a, b) => a.etaSeconds - b.etaSeconds);
  return entries;
}

export function formatEta(seconds: number): string {
  if (seconds < 30) return "Nu";
  if (seconds < 90) return "1 min";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} tim`;
}
