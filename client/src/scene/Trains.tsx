import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Projection } from "../data/projection";
import type { Train } from "../data/types";
import { useAppStore } from "../data/store";

interface Props {
  projection: Projection;
}

const TRAIL_LENGTH = 8;
const TICK_RATE = 1.0;

interface TrainState {
  train: Train;
  targetPos: THREE.Vector3;
  currentPos: THREE.Vector3;
  trail: THREE.Vector3[];
}

export function Trains({ projection }: Props) {
  const trainsMap = useAppStore((s) => s.trains);
  const hiddenLineIds = useAppStore((s) => s.hiddenLineIds);
  const hiddenModes = useAppStore((s) => s.hiddenModes);
  const setFollow = useAppStore((s) => s.setFollowTrain);
  const followId = useAppStore((s) => s.followTrainId);
  const setHovered = useAppStore((s) => s.setHoveredTrain);
  const setSelected = useAppStore((s) => s.setSelectedTrain);
  const selectedId = useAppStore((s) => s.selectedTrainId);

  const stateRef = useRef<Map<string, TrainState>>(new Map());

  useMemo(() => {
    const current = stateRef.current;
    for (const [id, t] of trainsMap) {
      if (hiddenLineIds.has(t.lineId) || hiddenModes.has(t.mode ?? "")) {
        current.delete(id);
        continue;
      }
      const [x, y, z] = projection.projectArray({ lat: t.lat, lon: t.lon, depth: t.depth });
      const target = new THREE.Vector3(x, y, z);
      if (!current.has(id)) {
        current.set(id, {
          train: t,
          targetPos: target,
          currentPos: target.clone(),
          trail: [],
        });
      } else {
        const st = current.get(id)!;
        st.train = t;
        st.targetPos.copy(target);
      }
    }
    for (const id of current.keys()) {
      if (!trainsMap.has(id)) current.delete(id);
    }
  }, [trainsMap, projection, hiddenLineIds, hiddenModes]);

  const trainGroup = useRef<THREE.Group>(null);
  const trailGroup = useRef<THREE.Group>(null);

  const instanced = useMemo(() => {
    const geo = new THREE.SphereGeometry(0.09, 10, 8);
    return geo;
  }, []);

  const trailGeo = useMemo(() => new THREE.SphereGeometry(0.05, 6, 4), []);

  useFrame((_state, delta) => {
    const lerpK = Math.min(1, delta * 4);
    let frameCount = 0;

    stateRef.current.forEach((st) => {
      st.currentPos.lerp(st.targetPos, lerpK);
      frameCount += 1;
      if (st.trail.length === 0 || st.trail[st.trail.length - 1].distanceTo(st.currentPos) > 0.16) {
        st.trail.push(st.currentPos.clone());
        if (st.trail.length > TRAIL_LENGTH) st.trail.shift();
      }
    });
  });

  return (
    <group>
      <group ref={trainGroup}>
        {Array.from(stateRef.current.values()).map((st) => (
          <TrainMesh
            key={st.train.id}
            state={st}
            followed={followId === st.train.id}
            selected={selectedId === st.train.id}
            onClick={() => {
              setSelected(selectedId === st.train.id ? null : st.train.id);
              setFollow(followId === st.train.id ? null : st.train.id);
            }}
            onHover={(h) => setHovered(h ? st.train.id : null)}
          />
        ))}
      </group>
    </group>
  );
}

function TrainMesh({
  state,
  followed,
  selected,
  onClick,
  onHover,
}: {
  state: TrainState;
  followed: boolean;
  selected: boolean;
  onClick: () => void;
  onHover: (h: boolean) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<THREE.Group>(null);
  const train = state.train;

  const color = useMemo(() => {
    if (train.status === "stopped") return "#ff3030";
    if (train.status === "delayed") return "#ffc04a";
    return train.color;
  }, [train.color, train.status]);

  const mode = train.mode ?? "subway";
  const sizeScale =
    mode === "subway" ? 1 :
    mode === "rail" ? 1.15 :
    mode === "ferry" ? 1.0 :
    mode === "lightrail" ? 0.8 :
    mode === "bus" ? 0.5 :
    0.65; // tram

  useFrame((s) => {
    if (meshRef.current) {
      meshRef.current.position.copy(state.currentPos);
      const pulse = 1 + Math.sin(s.clock.elapsedTime * 6 + train.lat * 2) * 0.18;
      meshRef.current.scale.setScalar((followed ? pulse * 1.8 : pulse) * sizeScale);
    }
    if (haloRef.current) {
      haloRef.current.position.copy(state.currentPos);
      const pulse = 1 + Math.sin(s.clock.elapsedTime * 3 + train.lat) * 0.15;
      haloRef.current.scale.setScalar(pulse * (followed ? 2 : 1) * sizeScale);
    }
    if (trailRef.current) {
      const children = trailRef.current.children as THREE.Mesh[];
      const trail = state.trail;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (i < trail.length) {
          child.visible = true;
          child.position.copy(trail[trail.length - 1 - i]);
          const fade = 1 - i / TRAIL_LENGTH;
          child.scale.setScalar(fade * 0.9 + 0.1);
          const mat = child.material as THREE.MeshBasicMaterial;
          mat.opacity = fade * 0.55;
        } else {
          child.visible = false;
        }
      }
    }
  });

  return (
    <group>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(false);
          document.body.style.cursor = "default";
        }}
      >
        <sphereGeometry args={[0.18, 12, 10]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={3.4}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={haloRef}>
        <sphereGeometry args={[0.44, 12, 10]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={trailRef}>
        {Array.from({ length: TRAIL_LENGTH }).map((_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.1, 6, 6]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}
