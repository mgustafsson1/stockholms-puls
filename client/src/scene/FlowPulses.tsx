import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LineCurve } from "../data/curves";

interface Props {
  curves: LineCurve[];
}

const PULSES_PER_KM = 0.9;
const PULSE_SPEED = 0.06; // fraction of curve per second

export function FlowPulses({ curves }: Props) {
  return (
    <group>
      {curves.map((lc) => (
        <LineFlow key={lc.id} curve={lc.curve} color={lc.color} length={lc.length} />
      ))}
    </group>
  );
}

function LineFlow({ curve, color, length }: { curve: THREE.CatmullRomCurve3; color: string; length: number }) {
  const count = Math.max(3, Math.round(length * PULSES_PER_KM));
  const colorObj = useMemo(() => new THREE.Color(color), [color]);

  const pointsRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => new Float32Array(count * 3), [count]);
  const phases = useMemo(() => Array.from({ length: count }, (_, i) => i / count), [count]);

  const texture = useMemo(() => makeRadialTexture(), []);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    for (let i = 0; i < count; i++) {
      phases[i] = (phases[i] + delta * PULSE_SPEED) % 1;
      const pt = curve.getPointAt(phases[i]);
      positions[i * 3] = pt.x;
      positions[i * 3 + 1] = pt.y;
      positions[i * 3 + 2] = pt.z;
    }
    const attr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    attr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} key={count}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.9}
        map={texture}
        color={colorObj}
        transparent
        opacity={0.95}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
        toneMapped={false}
      />
    </points>
  );
}

function makeRadialTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
