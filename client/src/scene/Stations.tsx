import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Network, Station } from "../data/types";
import type { Projection } from "../data/projection";
import { useAppStore } from "../data/store";

interface Props {
  network: Network;
  projection: Projection;
}

const LINE_HEX: Record<string, string> = {
  red: "#ff3d4a",
  green: "#4bd582",
  blue: "#39a7ff",
};

export function Stations({ network, projection }: Props) {
  const setHovered = useAppStore((s) => s.setHoveredStation);
  const hovered = useAppStore((s) => s.hoveredStationId);
  const setSelectedStation = useAppStore((s) => s.setSelectedStation);
  const selectedStationId = useAppStore((s) => s.selectedStationId);
  const trains = useAppStore((s) => s.trains);

  const activity = useMemo(() => {
    const map = new Map<string, number>();
    trains.forEach((t) => {
      map.set(t.from, (map.get(t.from) ?? 0) + 1);
      map.set(t.to, (map.get(t.to) ?? 0) + 0.5);
    });
    return map;
  }, [trains]);

  return (
    <group>
      {network.stations.map((s) => (
        <StationMarker
          key={s.id}
          station={s}
          projection={projection}
          hovered={hovered === s.id}
          selected={selectedStationId === s.id}
          onHover={(h) => setHovered(h ? s.id : null)}
          onClick={() => setSelectedStation(selectedStationId === s.id ? null : s.id)}
          activity={activity.get(s.id) ?? 0}
        />
      ))}
    </group>
  );
}

interface MarkerProps {
  station: Station;
  projection: Projection;
  hovered: boolean;
  selected: boolean;
  onHover: (h: boolean) => void;
  onClick: () => void;
  activity: number;
}

function StationMarker({ station, projection, hovered, selected, onHover, onClick, activity }: MarkerProps) {
  const pos = projection.projectArray(station);
  const ringRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  const color = useMemo(() => {
    if (station.lines.length > 1) return "#ffffff";
    return LINE_HEX[station.lines[0]] ?? "#ffffff";
  }, [station.lines]);

  const isMajor = station.lines.length > 1 || station.depth > 25;
  const baseScale = (isMajor ? 0.24 : 0.16) + (activity > 0 ? Math.min(activity, 4) * 0.04 : 0);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ringRef.current) {
      const pulse = 1 + Math.sin(t * 2 + station.lat * 3) * 0.08;
      const emph = selected ? 2.1 : hovered ? 1.6 : 1;
      ringRef.current.scale.setScalar(emph * pulse * (1 + activity * 0.08));
    }
    if (haloRef.current) {
      const mat = haloRef.current.material as THREE.MeshBasicMaterial;
      const baseOp = 0.12 + Math.max(0, Math.sin(t * 1.2 + station.lat * 2)) * 0.08 + activity * 0.02;
      mat.opacity = selected ? baseOp + 0.25 : baseOp;
    }
    if (groupRef.current && station.lines.length > 1) {
      groupRef.current.rotation.y = t * 0.3;
    }
  });

  return (
    <group ref={groupRef} position={pos}>
      <mesh
        ref={ringRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(false);
          document.body.style.cursor = "default";
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <sphereGeometry args={[baseScale, 16, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={2.2}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={haloRef}>
        <sphereGeometry args={[baseScale * 2.4, 14, 10]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} depthWrite={false} toneMapped={false} />
      </mesh>
      {station.depth > 0 && (
        <group>
          <mesh position={[0, -pos[1] / 2, 0]}>
            <cylinderGeometry args={[0.01, 0.01, Math.abs(pos[1]), 6, 1, true]} />
            <meshBasicMaterial color={color} transparent opacity={0.32} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
          </mesh>
          <mesh position={[0, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[baseScale * 1.4, baseScale * 1.8, 20]} />
            <meshBasicMaterial color={color} transparent opacity={0.45} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
          </mesh>
        </group>
      )}
    </group>
  );
}
