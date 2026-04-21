import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { useMemo } from "react";
import * as THREE from "three";
import { useAppStore } from "../data/store";
import { createProjection } from "../data/projection";
import { useNetworkCurves } from "../data/curves";
import { CityBase } from "./CityBase";
import { OsmTileLayer } from "./OsmTileLayer";
import { BuildingsLayer } from "./BuildingsLayer";
import { TunnelNetwork } from "./TunnelNetwork";
import { Stations } from "./Stations";
import { StationLabels } from "./StationLabels";
import { Trains } from "./Trains";
import { TrainLabels } from "./TrainLabels";
import { FlowPulses } from "./FlowPulses";
import { CameraController } from "./CameraController";
import { AlertHalos } from "./AlertHalos";

export function Scene() {
  const network = useAppStore((s) => s.network);
  const projection = useMemo(
    () => (network ? createProjection(network) : null),
    [network]
  );
  const curves = useNetworkCurves(network, projection);

  return (
    <Canvas
      shadows={false}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
        preserveDrawingBuffer: true,
      }}
      camera={{ position: [10, 14, 22], fov: 48, near: 0.1, far: 4000 }}
      dpr={[1, 1.5]}
    >
      <color attach="background" args={["#03050a"]} />
      {/* Fog keeps horizon/dust feeling atmospheric at mid-range but is set
          far enough out that dollying up to a full-Sweden view doesn't erase
          anything. Transit lines, stations, trains and OSM tiles individually
          opt out via `fog={false}` so they stay crisp at any distance. */}
      <fog attach="fog" args={["#03050a", 120, 480]} />
      <ambientLight intensity={0.2} />
      <directionalLight position={[6, 10, 4]} intensity={0.3} color="#a0c4ff" />
      <directionalLight position={[-8, 4, -6]} intensity={0.15} color="#4080ff" />
      <pointLight position={[0, -1.5, 0]} intensity={0.6} color="#ffffff" distance={8} decay={2} />

      {network && projection && (
        <>
          <CityBase projection={projection} />
          <OsmTileLayer network={network} projection={projection} />
          <BuildingsLayer projection={projection} />
          <TunnelNetwork curves={curves} />
          <FlowPulses curves={curves} />
          <Stations network={network} projection={projection} />
          <StationLabels network={network} projection={projection} />
          <Trains projection={projection} />
          <TrainLabels projection={projection} />
          <AlertHalos projection={projection} />
          <CameraController projection={projection} />
        </>
      )}

      <EffectComposer multisampling={0} disableNormalPass>
        <Bloom
          mipmapBlur
          intensity={1.4}
          luminanceThreshold={0.15}
          luminanceSmoothing={0.35}
          radius={0.85}
        />
        <Vignette eskil={false} offset={0.18} darkness={0.78} />
      </EffectComposer>
    </Canvas>
  );
}
