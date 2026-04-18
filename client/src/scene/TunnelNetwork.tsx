import { useMemo } from "react";
import * as THREE from "three";
import type { LineCurve } from "../data/curves";

interface Props {
  curves: LineCurve[];
}

export function TunnelNetwork({ curves }: Props) {
  return (
    <group>
      {curves.map((c) => (
        <TubeLine key={c.id} curve={c.curve} color={c.color} length={c.length} />
      ))}
    </group>
  );
}

function TubeLine({ curve, color, length }: { curve: THREE.CatmullRomCurve3; color: string; length: number }) {
  const tubularSegments = Math.min(256, Math.max(80, Math.floor(length * 2)));
  const coreGeo = useMemo(
    () => new THREE.TubeGeometry(curve, tubularSegments, 0.09, 10, false),
    [curve, tubularSegments]
  );
  const glowGeo = useMemo(
    () => new THREE.TubeGeometry(curve, tubularSegments, 0.3, 10, false),
    [curve, tubularSegments]
  );

  return (
    <group>
      <mesh geometry={coreGeo}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.8}
          transparent
          opacity={0.85}
          roughness={0.4}
          metalness={0.0}
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={glowGeo}>
        <meshBasicMaterial color={color} transparent opacity={0.06} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}
