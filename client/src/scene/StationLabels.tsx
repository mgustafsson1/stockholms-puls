import { useMemo } from "react";
import { Text, Billboard } from "@react-three/drei";
import * as THREE from "three";
import type { Network } from "../data/types";
import type { Projection } from "../data/projection";
import { useAppStore } from "../data/store";

interface Props {
  network: Network;
  projection: Projection;
}

export function StationLabels({ network, projection }: Props) {
  const hoveredId = useAppStore((s) => s.hoveredStationId);
  const showLabels = useAppStore((s) => s.showLabels);

  const labelData = useMemo(() => {
    return network.stations.map((s) => {
      const pos = projection.projectArray(s);
      const isMajor = (s.lines?.length ?? 0) > 1 || s.depth > 25;
      return { s, pos, isMajor };
    });
  }, [network, projection]);

  if (!showLabels) {
    // Show only hovered labels
    return (
      <group>
        {labelData.filter((d) => d.s.id === hoveredId).map((d) => (
          <StationLabel key={d.s.id} name={d.s.name} pos={d.pos} depth={d.s.depth} major hovered />
        ))}
      </group>
    );
  }

  return (
    <group>
      {labelData.map((d) => (
        <StationLabel
          key={d.s.id}
          name={d.s.name}
          pos={d.pos}
          depth={d.s.depth}
          major={d.isMajor}
          hovered={hoveredId === d.s.id}
        />
      ))}
    </group>
  );
}

function StationLabel({
  name,
  pos,
  depth,
  major,
  hovered,
}: {
  name: string;
  pos: [number, number, number];
  depth: number;
  major: boolean;
  hovered: boolean;
}) {
  const fontSize = hovered ? 0.35 : major ? 0.25 : 0.17;
  const opacity = hovered ? 1 : major ? 0.92 : 0.58;
  const offsetY = (major ? 0.35 : 0.25) + (hovered ? 0.12 : 0);

  return (
    <Billboard position={[pos[0], pos[1] + offsetY, pos[2]]}>
      <Text
        fontSize={fontSize}
        color="#ffffff"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.012}
        outlineColor="#02060c"
        outlineOpacity={0.9}
        fillOpacity={opacity}
      >
        {name}
      </Text>
      {hovered && depth > 0 && (
        <Text
          position={[0, -fontSize - 0.06, 0]}
          fontSize={0.11}
          color="#8fb3e2"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.008}
          outlineColor="#02060c"
        >
          {depth} m under mark
        </Text>
      )}
    </Billboard>
  );
}
