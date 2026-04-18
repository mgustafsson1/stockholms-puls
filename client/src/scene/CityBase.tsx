import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Projection } from "../data/projection";

const RIDDARFJARDEN_LATLON: [number, number][] = [
  [59.327, 17.995], [59.325, 18.015], [59.322, 18.035],
  [59.321, 18.058], [59.320, 18.075], [59.318, 18.090],
  [59.314, 18.098], [59.311, 18.102], [59.308, 18.108],
  [59.305, 18.115], [59.308, 18.088], [59.313, 18.070],
  [59.316, 18.048], [59.320, 18.028], [59.324, 18.000],
];

const MALAREN_LATLON: [number, number][] = [
  [59.330, 17.820], [59.335, 17.900], [59.332, 17.960],
  [59.320, 17.990], [59.305, 17.985], [59.290, 17.965],
  [59.275, 17.935], [59.265, 17.890], [59.275, 17.850],
  [59.295, 17.810], [59.315, 17.805],
];

const SALTSJON_LATLON: [number, number][] = [
  [59.320, 18.100], [59.315, 18.130], [59.305, 18.145],
  [59.293, 18.140], [59.280, 18.130], [59.275, 18.105],
  [59.285, 18.085], [59.300, 18.085], [59.315, 18.090],
];

const BRUNNSVIKEN_LATLON: [number, number][] = [
  [59.365, 18.050], [59.370, 18.055], [59.380, 18.050],
  [59.385, 18.040], [59.380, 18.030], [59.370, 18.035],
];

export function CityBase({ projection }: { projection: Projection }) {
  const waterOutlines = useMemo(() => {
    return [RIDDARFJARDEN_LATLON, MALAREN_LATLON, SALTSJON_LATLON, BRUNNSVIKEN_LATLON].map((pts) => {
      const scenePts = pts.map(([lat, lon]) => {
        const [x, , z] = projection.projectArray({ lat, lon });
        return new THREE.Vector3(x, 0, z);
      });
      scenePts.push(scenePts[0].clone());
      return new THREE.BufferGeometry().setFromPoints(scenePts);
    });
  }, [projection]);

  const waterFills = useMemo(() => {
    return [RIDDARFJARDEN_LATLON, MALAREN_LATLON, SALTSJON_LATLON, BRUNNSVIKEN_LATLON].map((pts) => {
      const shape = new THREE.Shape();
      const [x0, , z0] = projection.projectArray({ lat: pts[0][0], lon: pts[0][1] });
      shape.moveTo(x0, z0);
      for (let i = 1; i < pts.length; i++) {
        const [x, , z] = projection.projectArray({ lat: pts[i][0], lon: pts[i][1] });
        shape.lineTo(x, z);
      }
      shape.lineTo(x0, z0);
      return new THREE.ShapeGeometry(shape);
    });
  }, [projection]);

  const geologyGeos = useMemo(
    () => [
      { y: -0.8, opacity: 0.025, radius: 110 },
      { y: -1.8, opacity: 0.03, radius: 85 },
      { y: -2.8, opacity: 0.035, radius: 65 },
    ],
    []
  );

  const stars = useStarField(320);
  const dust = useDustField(120);
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (ringRef.current) {
      const t = state.clock.elapsedTime;
      ringRef.current.rotation.z = t * 0.04;
    }
  });

  return (
    <group>
      <MajorGrid />
      <MinorGrid />

      {waterFills.map((geo, i) => (
        <mesh key={`wf-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <primitive object={geo} attach="geometry" />
          <meshBasicMaterial color="#123354" transparent opacity={0.14} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      {waterOutlines.map((geo, i) => (
        <line key={`wl-${i}`} position={[0, 0.002, 0]}>
          <primitive object={geo} attach="geometry" />
          <lineBasicMaterial color="#4ca5e8" transparent opacity={0.55} linewidth={1} />
        </line>
      ))}

      {geologyGeos.map(({ y, opacity, radius }, i) => (
        <mesh key={`g-${i}`} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[radius, 64]} />
          <meshBasicMaterial color="#0e1a2e" transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}

      <mesh ref={ringRef} position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[80, 80.3, 128]} />
        <meshBasicMaterial color="#1d3558" transparent opacity={0.3} depthWrite={false} />
      </mesh>

      <primitive object={stars} />
      <primitive object={dust} />
      <HorizonGlow />
    </group>
  );
}

function MajorGrid() {
  const grid = useMemo(() => {
    const size = 260;
    const divisions = 26;
    const geo = new THREE.BufferGeometry();
    const verts: number[] = [];
    const step = size / divisions;
    for (let i = 0; i <= divisions; i++) {
      const p = -size / 2 + i * step;
      verts.push(-size / 2, 0, p, size / 2, 0, p);
      verts.push(p, 0, -size / 2, p, 0, size / 2);
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: "#24406b",
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    return new THREE.LineSegments(geo, mat);
  }, []);
  return <primitive object={grid} position={[0, 0.001, 0]} />;
}

function MinorGrid() {
  const grid = useMemo(() => {
    const size = 200;
    const divisions = 100;
    const geo = new THREE.BufferGeometry();
    const verts: number[] = [];
    const step = size / divisions;
    for (let i = 0; i <= divisions; i++) {
      const p = -size / 2 + i * step;
      verts.push(-size / 2, 0, p, size / 2, 0, p);
      verts.push(p, 0, -size / 2, p, 0, size / 2);
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: "#0f1d33",
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    return new THREE.LineSegments(geo, mat);
  }, []);
  return <primitive object={grid} position={[0, 0.0005, 0]} />;
}

function useStarField(count: number) {
  return useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 50 + Math.random() * 30;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.45 + 0.05;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const shade = 0.55 + Math.random() * 0.45;
      col[i * 3] = shade * (0.7 + Math.random() * 0.3);
      col[i * 3 + 1] = shade * (0.75 + Math.random() * 0.25);
      col[i * 3 + 2] = shade;
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.18,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geo, mat);
  }, [count]);
}

function useDustField(count: number) {
  return useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 40;
      pos[i * 3 + 1] = Math.random() * 12 + 0.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.04,
      color: "#9bc4ff",
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geo, mat);
  }, [count]);
}

function HorizonGlow() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.05 + Math.sin(t * 0.4) * 0.015;
  });
  return (
    <mesh ref={ref} position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[55, 130, 72]} />
      <meshBasicMaterial color="#1d4a8a" transparent opacity={0.06} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}
