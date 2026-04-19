import { useRef, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useAppStore } from "../data/store";
import type { Projection } from "../data/projection";

interface Props {
  projection: Projection;
}

const PRESETS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { pos: [10, 14, 22], target: [-3, -1.5, 0] },
  "cross-section": { pos: [-3, 3, 30], target: [-3, -2, 0] },
  anomaly: { pos: [4, 10, 14], target: [-3, -1.5, 0] },
};

const IDLE_BEFORE_ORBIT_MS = 30_000;

export function CameraController({ projection }: Props) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const mode = useAppStore((s) => s.cameraMode);
  const followId = useAppStore((s) => s.followTrainId);
  const trains = useAppStore((s) => s.trains);
  const selectedStationId = useAppStore((s) => s.selectedStationId);
  const network = useAppStore((s) => s.network);

  const targetVec = useRef(new THREE.Vector3(0, -1, 0));
  const desiredPos = useRef(new THREE.Vector3(6, 12, 16));
  const lastInteraction = useRef(Date.now());
  const [autoOrbit, setAutoOrbit] = useState(false);
  const orbitAngle = useRef(0);
  const flyToStationUntil = useRef(0);

  useEffect(() => {
    const preset = PRESETS[mode];
    if (preset) {
      desiredPos.current.set(...preset.pos);
      targetVec.current.set(...preset.target);
    }
  }, [mode]);

  useEffect(() => {
    if (!selectedStationId || !network) return;
    const station = network.stations.find((s) => s.id === selectedStationId);
    if (!station) return;
    const [x, y, z] = projection.projectArray(station);
    targetVec.current.set(x, y, z);
    desiredPos.current.set(x + 2.5, y + 3.5, z + 2.5);
    flyToStationUntil.current = Date.now() + 900;
    lastInteraction.current = Date.now();
    setAutoOrbit(false);
  }, [selectedStationId, network, projection]);

  // Reset to overview whenever the active network (region) changes so we're
  // not stuck looking at old coordinates.
  useEffect(() => {
    const preset = PRESETS.overview;
    desiredPos.current.set(...preset.pos);
    targetVec.current.set(...preset.target);
    flyToStationUntil.current = Date.now() + 900;
    lastInteraction.current = Date.now();
    setAutoOrbit(false);
  }, [network]);

  useEffect(() => {
    const handler = () => {
      lastInteraction.current = Date.now();
      setAutoOrbit(false);
    };
    window.addEventListener("pointerdown", handler);
    window.addEventListener("wheel", handler, { passive: true });
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("wheel", handler);
      window.removeEventListener("keydown", handler);
    };
  }, []);

  useFrame((state, delta) => {
    const lerp = Math.min(1, delta * 1.6);
    const idleTime = Date.now() - lastInteraction.current;

    if (flyToStationUntil.current > Date.now()) {
      const k = Math.min(1, delta * 3.5);
      camera.position.lerp(desiredPos.current, k);
      if (controlsRef.current) {
        controlsRef.current.target.lerp(targetVec.current, k);
      }
      controlsRef.current?.update();
      return;
    }

    if (mode === "overview") {
      if (!autoOrbit && idleTime > IDLE_BEFORE_ORBIT_MS) {
        setAutoOrbit(true);
        const angle = Math.atan2(camera.position.x, camera.position.z);
        orbitAngle.current = angle;
      }

      if (autoOrbit) {
        orbitAngle.current += delta * 0.06;
        const dist = 30;
        const targetY = 16 + Math.sin(state.clock.elapsedTime * 0.12) * 3;
        desiredPos.current.set(
          Math.sin(orbitAngle.current) * dist,
          targetY,
          Math.cos(orbitAngle.current) * dist
        );
        targetVec.current.lerp(new THREE.Vector3(-3, -1.5, 0), lerp);
        camera.position.lerp(desiredPos.current, Math.min(1, delta * 0.6));
        if (controlsRef.current) {
          controlsRef.current.target.lerp(targetVec.current, lerp);
        }
      }
    } else if (mode === "follow" && followId) {
      const t = trains.get(followId);
      if (t) {
        const [x, y, z] = projection.projectArray({ lat: t.lat, lon: t.lon, depth: t.depth });
        targetVec.current.lerp(new THREE.Vector3(x, y, z), Math.min(1, delta * 3));
        const offset = new THREE.Vector3(1.2, 1.5, 1.2);
        desiredPos.current.lerp(new THREE.Vector3(x + offset.x, y + offset.y, z + offset.z), lerp);
        camera.position.lerp(desiredPos.current, lerp);
        if (controlsRef.current) {
          controlsRef.current.target.lerp(targetVec.current, Math.min(1, delta * 2));
        }
      }
    } else if (mode === "anomaly") {
      let anomaly: any = null;
      for (const t of trains.values()) {
        if (t.status !== "ok") { anomaly = t; break; }
      }
      if (anomaly) {
        const [x, y, z] = projection.projectArray({ lat: anomaly.lat, lon: anomaly.lon, depth: anomaly.depth });
        targetVec.current.lerp(new THREE.Vector3(x, y, z), Math.min(1, delta * 1.2));
        const orbit = state.clock.elapsedTime * 0.2;
        desiredPos.current.lerp(
          new THREE.Vector3(x + Math.cos(orbit) * 3.5, y + 2.5, z + Math.sin(orbit) * 3.5),
          lerp
        );
        camera.position.lerp(desiredPos.current, lerp);
        if (controlsRef.current) {
          controlsRef.current.target.lerp(targetVec.current, Math.min(1, delta * 2));
        }
      }
    } else if (mode === "cross-section") {
      camera.position.lerp(desiredPos.current, lerp);
      if (controlsRef.current) {
        controlsRef.current.target.lerp(targetVec.current, Math.min(1, delta * 2));
      }
    }

    controlsRef.current?.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={mode !== "follow" && !autoOrbit}
      enableZoom={true}
      enableRotate={mode !== "follow" && !autoOrbit}
      screenSpacePanning
      mouseButtons={{
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      }}
      touches={{
        ONE: THREE.TOUCH.PAN,
        TWO: THREE.TOUCH.DOLLY_ROTATE,
      }}
      keyPanSpeed={25}
      panSpeed={2.5}
      zoomSpeed={1.6}
      rotateSpeed={0.9}
      minDistance={0.8}
      maxDistance={600}
      maxPolarAngle={Math.PI * 0.92}
      minPolarAngle={0.05}
      dampingFactor={0.08}
      enableDamping
    />
  );
}
