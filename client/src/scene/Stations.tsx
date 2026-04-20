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

const MODE_HEX: Record<string, string> = {
  subway: "#ffffff",
  rail: "#ff9147",
  lightrail: "#c99bff",
  tram: "#ffde5a",
  ferry: "#4cdadd",
};

export function Stations({ network, projection }: Props) {
  const setHovered = useAppStore((s) => s.setHoveredStation);
  const hovered = useAppStore((s) => s.hoveredStationId);
  const setSelectedStation = useAppStore((s) => s.setSelectedStation);
  const selectedStationId = useAppStore((s) => s.selectedStationId);
  const trains = useAppStore((s) => s.trains);
  const chronicScores = useAppStore((s) => s.chronicScores);
  const chronicMax = useAppStore((s) => s.chronicMax);

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
          chronic={chronicMax > 0 ? (chronicScores[s.id] ?? 0) / chronicMax : 0}
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
  // Normalised chronic-delay score 0..1 for this station. 0 = reliably on
  // time, 1 = worst-in-region chronic offender.
  chronic: number;
}

// Green → amber → red colour ramp for the chronic-delay halo.
function chronicColor(t: number) {
  const clamped = Math.max(0, Math.min(1, t));
  // Stops: 0 = green, 0.5 = amber, 1 = red
  if (clamped < 0.5) {
    const k = clamped / 0.5; // 0..1 between green and amber
    const r = Math.round(75 + (255 - 75) * k);
    const g = Math.round(213 + (192 - 213) * k);
    const b = Math.round(130 + (74 - 130) * k);
    return `rgb(${r},${g},${b})`;
  }
  const k = (clamped - 0.5) / 0.5; // 0..1 between amber and red
  const r = Math.round(255 + (255 - 255) * k);
  const g = Math.round(192 + (48 - 192) * k);
  const b = Math.round(74 + (48 - 74) * k);
  return `rgb(${r},${g},${b})`;
}

function StationMarker({ station, projection, hovered, selected, onHover, onClick, activity, chronic }: MarkerProps) {
  const pos = projection.projectArray(station);
  const ringRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  const color = useMemo(() => {
    const lines = station.lines ?? [];
    if (lines.length > 1) return "#ffffff";
    if (lines.length === 1 && LINE_HEX[lines[0]]) return LINE_HEX[lines[0]];
    return MODE_HEX[station.mode ?? "subway"] ?? "#ffffff";
  }, [station.lines, station.mode]);

  const linesLen = station.lines?.length ?? 0;
  const isMajor = linesLen > 1 || station.depth > 25;
  const isSubway = (station.mode ?? "subway") === "subway";
  const modeScale = isSubway ? 1 : station.mode === "rail" ? 0.85 : station.mode === "ferry" ? 0.7 : 0.6;
  const baseScale = ((isMajor ? 0.24 : 0.16) + (activity > 0 ? Math.min(activity, 4) * 0.04 : 0)) * modeScale;

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
    if (groupRef.current && linesLen > 1) {
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
          fog={false}
        />
      </mesh>
      <mesh ref={haloRef}>
        <sphereGeometry args={[baseScale * 2.4, 14, 10]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} depthWrite={false} toneMapped={false} fog={false} />
      </mesh>
      {station.depth > 0 && (
        <group>
          <mesh position={[0, -pos[1] / 2, 0]}>
            <cylinderGeometry args={[0.01, 0.01, Math.abs(pos[1]), 6, 1, true]} />
            <meshBasicMaterial color={color} transparent opacity={0.32} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} fog={false} />
          </mesh>
          <mesh position={[0, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[baseScale * 1.4, baseScale * 1.8, 20]} />
            <meshBasicMaterial color={color} transparent opacity={0.45} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} fog={false} />
          </mesh>
        </group>
      )}
      {chronic > 0.08 && (
        // Chronic-delay halo: a flat ring on the ground plane whose size,
        // colour and opacity scale with how reliably unreliable this
        // station has been over the last day.
        <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[baseScale * 2.4, baseScale * (2.4 + chronic * 2.2), 48]} />
          <meshBasicMaterial
            color={chronicColor(chronic)}
            transparent
            opacity={0.18 + chronic * 0.35}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            fog={false}
          />
        </mesh>
      )}
    </group>
  );
}
