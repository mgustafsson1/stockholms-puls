import { useMemo } from "react";
import * as THREE from "three";
import type { Network } from "./types";
import type { Projection } from "./projection";

const LINE_OFFSET: Record<string, [number, number]> = {
  T13: [0, 0],
  T14: [0.045, 0.045],
  T17: [0, 0],
  T18: [0.04, -0.04],
  T19: [-0.04, 0.04],
  T10: [0, 0],
  T11: [0.06, 0.02],
};

export interface LineCurve {
  id: string;
  color: string;
  curve: THREE.Curve<THREE.Vector3>;
  points: THREE.Vector3[];
  length: number;
}

export function useNetworkCurves(network: Network | null, projection: Projection | null): LineCurve[] {
  return useMemo(() => {
    if (!network || !projection) return [];
    const out: LineCurve[] = [];
    for (const line of network.lines) {
      const [ox, oz] = LINE_OFFSET[line.id] ?? [0, 0];
      const pts: THREE.Vector3[] = [];
      for (const sid of line.stations) {
        const s = projection.stationLookup.get(sid);
        if (!s) continue;
        const [x, y, z] = projection.projectArray(s);
        pts.push(new THREE.Vector3(x + ox, y, z + oz));
      }
      if (pts.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.85);
      out.push({
        id: line.id,
        color: line.color,
        curve,
        points: pts,
        length: curve.getLength(),
      });
    }
    return out;
  }, [network, projection]);
}
