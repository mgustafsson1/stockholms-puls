import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useAppStore } from "../data/store";
import type { Projection } from "../data/projection";

interface Props {
  projection: Projection;
}

export function AlertHalos({ projection }: Props) {
  const alerts = useAppStore((s) => s.alerts);

  return (
    <group>
      {alerts.map((a) => {
        const s = projection.stationLookup.get(a.stationId);
        if (!s) return null;
        const pos = projection.projectArray(s);
        return <AlertHalo key={a.id} pos={pos} createdAt={a.createdAt} />;
      })}
    </group>
  );
}

function AlertHalo({ pos, createdAt }: { pos: [number, number, number]; createdAt: number }) {
  const rings = useRef<(THREE.Mesh | null)[]>([null, null, null]);
  const columnRef = useRef<THREE.Mesh>(null);
  const sparkRef = useRef<THREE.Mesh>(null);

  const columnMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#ff3d4a") },
        uTime: { value: 0 },
        uIntensity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying float vY;
        varying vec2 vUv;
        void main() {
          vY = position.y;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uIntensity;
        varying float vY;
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
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const age = (Date.now() - createdAt) / 1000;
    const fadeOut = Math.max(0, 1 - age / 180);

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
      columnMat.uniforms.uIntensity.value = fadeOut;
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
            color="#ff3d4a"
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

      <mesh ref={columnRef} position={[0, 2.5, 0]}>
        <cylinderGeometry args={[0.45, 0.18, 5, 16, 1, true]} />
        <primitive object={columnMat} attach="material" />
      </mesh>

      <mesh ref={sparkRef} position={[0, 0.1, 0]}>
        <sphereGeometry args={[0.14, 16, 10]} />
        <meshBasicMaterial color="#ffbac0" transparent opacity={0.9} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}
