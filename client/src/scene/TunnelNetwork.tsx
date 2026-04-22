import { useMemo } from "react";
import * as THREE from "three";
import type { LineCurve } from "../data/curves";
import type { Mode } from "../data/types";

interface Props {
  curves: LineCurve[];
}

export function TunnelNetwork({ curves }: Props) {
  return (
    <group>
      {curves.map((c) => (
        <ModeLine key={c.id} curve={c.curve} color={c.color} length={c.length} mode={c.mode} />
      ))}
    </group>
  );
}

interface StyleSpec {
  coreRadius: number;
  glowRadius: number;
  coreOpacity: number;
  glowOpacity: number;
  emissiveIntensity: number;
  segmentsPerUnit: number;
}

const MODE_STYLE: Record<Mode, StyleSpec> = {
  subway:    { coreRadius: 0.09, glowRadius: 0.30, coreOpacity: 0.85, glowOpacity: 0.06, emissiveIntensity: 1.8, segmentsPerUnit: 2.0 },
  rail:      { coreRadius: 0.11, glowRadius: 0.38, coreOpacity: 0.90, glowOpacity: 0.08, emissiveIntensity: 2.2, segmentsPerUnit: 1.6 },
  lightrail: { coreRadius: 0.07, glowRadius: 0.24, coreOpacity: 0.82, glowOpacity: 0.06, emissiveIntensity: 1.6, segmentsPerUnit: 2.0 },
  tram:      { coreRadius: 0.05, glowRadius: 0.18, coreOpacity: 0.80, glowOpacity: 0.05, emissiveIntensity: 1.4, segmentsPerUnit: 2.4 },
  ferry:     { coreRadius: 0.04, glowRadius: 0.22, coreOpacity: 0.45, glowOpacity: 0.10, emissiveIntensity: 1.0, segmentsPerUnit: 1.2 },
  bus:       { coreRadius: 0.04, glowRadius: 0.14, coreOpacity: 0.70, glowOpacity: 0.04, emissiveIntensity: 1.0, segmentsPerUnit: 2.4 },
};

function ModeLine({ curve, color, length, mode }: { curve: THREE.CatmullRomCurve3; color: string; length: number; mode: Mode }) {
  const style = MODE_STYLE[mode] ?? MODE_STYLE.subway;
  const tubularSegments = Math.min(256, Math.max(40, Math.floor(length * style.segmentsPerUnit)));
  const coreGeo = useMemo(
    () => new THREE.TubeGeometry(curve, tubularSegments, style.coreRadius, 8, false),
    [curve, tubularSegments, style.coreRadius]
  );
  const glowGeo = useMemo(
    () => new THREE.TubeGeometry(curve, tubularSegments, style.glowRadius, 8, false),
    [curve, tubularSegments, style.glowRadius]
  );

  return (
    <group>
      <mesh geometry={coreGeo}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={style.emissiveIntensity}
          transparent
          opacity={style.coreOpacity}
          roughness={mode === "ferry" ? 0.1 : 0.4}
          metalness={mode === "rail" ? 0.25 : 0.0}
          toneMapped={false}
          // Scene fog fades everything past ~160 units; opt the transit
          // skeleton out so users can dolly out over whole regions without
          // the network dissolving into the background.
          fog={false}
        />
      </mesh>
      <mesh geometry={glowGeo}>
        <meshBasicMaterial color={color} transparent opacity={style.glowOpacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} fog={false} />
      </mesh>
    </group>
  );
}
