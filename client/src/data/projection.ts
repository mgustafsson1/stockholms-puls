import type { Network, Station } from "./types";

const HORIZ_SCALE = 1 / 300;
const DEPTH_EXAGGERATION = 0.10;

export function createProjection(network: Network) {
  const { lat: lat0, lon: lon0 } = network.origin;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  const mPerDegLat = 110574;
  const mPerDegLon = 111320 * cosLat;

  function project(point: { lat: number; lon: number; depth?: number }) {
    const eastM = (point.lon - lon0) * mPerDegLon;
    const northM = (point.lat - lat0) * mPerDegLat;
    const depth = point.depth ?? 0;
    return {
      x: eastM * HORIZ_SCALE,
      y: -depth * DEPTH_EXAGGERATION,
      z: -northM * HORIZ_SCALE,
    };
  }

  function projectArray(point: { lat: number; lon: number; depth?: number }): [number, number, number] {
    const p = project(point);
    return [p.x, p.y, p.z];
  }

  const stationLookup = new Map<string, Station>();
  for (const s of network.stations) stationLookup.set(s.id, s);

  function stationPos(id: string): [number, number, number] | null {
    const s = stationLookup.get(id);
    return s ? projectArray(s) : null;
  }

  return { project, projectArray, stationPos, stationLookup };
}

export type Projection = ReturnType<typeof createProjection>;
