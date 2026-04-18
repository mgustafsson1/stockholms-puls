import { useMemo, useRef } from "react";
import { Text, Billboard } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useAppStore } from "../data/store";
import type { Projection } from "../data/projection";

interface Props {
  projection: Projection;
}

export function TrainLabels({ projection }: Props) {
  const trains = useAppStore((s) => s.trains);
  const hoveredId = useAppStore((s) => s.hoveredTrainId);
  const selectedId = useAppStore((s) => s.selectedTrainId);
  const showLabels = useAppStore((s) => s.showLabels);

  const trainArr = useMemo(() => Array.from(trains.values()), [trains]);

  return (
    <group>
      {trainArr.map((t) => {
        const focus = hoveredId === t.id || selectedId === t.id;
        if (!showLabels && !focus) return null;
        return (
          <TrainLabel
            key={t.id}
            train={t}
            projection={projection}
            focused={focus}
          />
        );
      })}
    </group>
  );
}

function TrainLabel({ train, projection, focused }: any) {
  const ref = useRef<THREE.Group>(null);
  const [x, y, z] = projection.projectArray({ lat: train.lat, lon: train.lon, depth: train.depth });
  const posVec = useRef(new THREE.Vector3(x, y, z));

  useFrame(() => {
    if (!ref.current) return;
    const [nx, ny, nz] = projection.projectArray({ lat: train.lat, lon: train.lon, depth: train.depth });
    posVec.current.lerp(new THREE.Vector3(nx, ny, nz), 0.3);
    ref.current.position.set(posVec.current.x, posVec.current.y + 0.35, posVec.current.z);
  });

  const color = train.status === "stopped" ? "#ff6a6a" : train.status === "delayed" ? "#ffc87a" : "#ffffff";

  return (
    <group ref={ref}>
      <Billboard>
        <Text
          fontSize={focused ? 0.28 : 0.16}
          color={color}
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.01}
          outlineColor="#000"
          outlineOpacity={0.95}
          fillOpacity={focused ? 1 : 0.75}
        >
          {train.lineId}
        </Text>
      </Billboard>
    </group>
  );
}
