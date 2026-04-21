import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useAppStore } from "../data/store";
import type { Projection } from "../data/projection";

interface Props {
  projection: Projection;
}

// Only WARNING / SEVERE alerts that resolve to a drawn station get a halo.
// INFO alerts are left to the Alerts panel so the scene doesn't drown in
// banal "indragen hållplats"-markers.
type Severity = "SEVERE" | "WARNING";
const SEVERITY_COLOR: Record<Severity, string> = {
  SEVERE: "#ff3d4a",
  WARNING: "#ffc04a",
};

export function AlertHalos({ projection }: Props) {
  const alerts = useAppStore((s) => s.alerts);

  const visible = alerts.filter((a) => {
    if (!a.stationId) return false;
    const sev = a.severity;
    return sev === "SEVERE" || sev === "WARNING";
  });

  return (
    <group>
      {visible.map((a) => {
        const s = projection.stationLookup.get(a.stationId!);
        if (!s) return null;
        const pos = projection.projectArray(s);
        const sev = (a.severity as Severity) ?? "WARNING";
        return (
          <AlertHalo
            key={a.id}
            pos={pos}
            createdAt={a.createdAt}
            color={SEVERITY_COLOR[sev]}
            severe={sev === "SEVERE"}
          />
        );
      })}
    </group>
  );
}

function AlertHalo({
  pos,
  createdAt,
  color,
  severe,
}: {
  pos: [number, number, number];
  createdAt: number;
  color: string;
  severe: boolean;
}) {
  const rings = useRef<(THREE.Mesh | null)[]>([null, null, null]);
  const columnRef = useRef<THREE.Mesh>(null);
  const sparkRef = useRef<THREE.Mesh>(null);

  const columnMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uTime: { value: 0 },
        uIntensity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uIntensity;
        varying vec2 vUv;
        void main() {
          float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
          edge = pow(edge, 2.5);
          float up = 1.0 - smoothstep(0.0, 1.0, vUv.y);
          float pulse = 0.6 + 0.4 * sin(uTime * 3.0 + vUv.y * 12.0);
          float alpha = edge * up * pulse * uIntensity * 0.9;
          gl_FragColor = vec4(uColor * (1.2 + pulse * 0.6), alpha);
        }
      `,
    });
  }, [color]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Fade after 30 min (SEVERE kept longer than the old 3-min default so
    // real disruption is visible for its duration, not just a quick flash).
    const age = (Date.now() - createdAt) / 1000;
    const fadeOut = Math.max(0, 1 - age / (severe ? 1800 : 900));

    rings.current.forEach((ring, i) => {
      if (!ring) return;
      const cycle = ((t * 0.8 + i * 0.33) % 1.5);
      const scale = 0.3 + cycle * 1.8;
      const opacity = Math.max(0, 0.7 - cycle * 0.5) * fadeOut;
      ring.scale.setScalar(scale);
      const mat = ring.material as THREE.MeshBasicMaterial;
      mat.opacity = opacity;
    });

    if (columnRef.current) {
      columnMat.uniforms.uTime.value = t;
      columnMat.uniforms.uIntensity.value = fadeOut * (severe ? 1 : 0.55);
    }

    if (sparkRef.current) {
      const scale = 1 + Math.sin(t * 4) * 0.15;
      sparkRef.current.scale.setScalar(scale * fadeOut);
    }
  });

  return (
    <group position={[pos[0], 0, pos[2]]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => (rings.current[i] = el)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
          <ringGeometry args={[0.22, 0.28, 64]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.5}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
            fog={false}
          />
        </mesh>
      ))}

      <mesh ref={columnRef} position={[0, severe ? 2.5 : 1.5, 0]}>
        <cylinderGeometry args={[severe ? 0.45 : 0.3, severe ? 0.18 : 0.12, severe ? 5 : 3, 16, 1, true]} />
        <primitive object={columnMat} attach="material" />
      </mesh>

      <mesh ref={sparkRef} position={[0, 0.1, 0]}>
        <sphereGeometry args={[severe ? 0.14 : 0.09, 16, 10]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
    </group>
  );
}
