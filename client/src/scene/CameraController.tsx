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
  const setSelectedTrain = useAppStore((s) => s.setSelectedTrain);
  const network = useAppStore((s) => s.network);

  const targetVec = useRef(new THREE.Vector3(0, -1, 0));
  const desiredPos = useRef(new THREE.Vector3(6, 12, 16));
  const lastInteraction = useRef(Date.now());
  const [autoOrbit, setAutoOrbit] = useState(false);
  const orbitAngle = useRef(0);
  const flyToStationUntil = useRef(0);

  // Anomaly-cycling state. When the user sits in "anomaly" mode we orbit
  // each anomalous vehicle for a fixed dwell, then advance to the next.
  // The camera needs 2–3 s to fly in, so the dwell has to comfortably clear
  // that plus leave time to read the info panel.
  const anomalyDwell = useRef({ id: null as string | null, since: 0 });
  const ANOMALY_DWELL_MS = 22_000;

  useEffect(() => {
    const preset = PRESETS[mode];
    if (preset) {
      desiredPos.current.set(...preset.pos);
      targetVec.current.set(...preset.target);
    }
    // Reset anomaly cycle whenever we leave the mode so re-entering starts
    // at the top of the list again.
    if (mode !== "anomaly") {
      anomalyDwell.current = { id: null, since: 0 };
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

  // Fly to an arbitrary lat/lon (bus stop picked in search, etc.) — this is a
  // write-only trigger that re-fires even when the same point is picked twice.
  const focusPoint = useAppStore((s) => s.focusPoint);
  useEffect(() => {
    if (!focusPoint) return;
    const [x, y, z] = projection.projectArray({ lat: focusPoint.lat, lon: focusPoint.lon, depth: 0 });
    targetVec.current.set(x, y, z);
    desiredPos.current.set(x + 2.5, y + 3.5, z + 2.5);
    flyToStationUntil.current = Date.now() + 900;
    lastInteraction.current = Date.now();
    setAutoOrbit(false);
  }, [focusPoint, projection]);

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

  // Hold shift to swap the left mouse button from pan to rotate — makes
  // orbit discoverable on trackpads that don't have a right-click.
  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(false); };
    const blur = () => setShiftHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Keyboard rotation: Q / E yaw around the orbit target, R / F tilt.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!controlsRef.current) return;
      // Never intercept modifier combos — Cmd+R, Ctrl+R etc. must stay as
      // browser reload shortcuts.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const target = controlsRef.current.target as THREE.Vector3;
      const yaw = e.key === "q" || e.key === "Q" ? -0.08
        : e.key === "e" || e.key === "E" ? 0.08
        : 0;
      const pitch = e.key === "r" || e.key === "R" ? -0.06
        : e.key === "f" || e.key === "F" ? 0.06
        : 0;
      if (yaw === 0 && pitch === 0) return;
      e.preventDefault();
      const offset = camera.position.clone().sub(target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta += yaw;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi + pitch, 0.05, Math.PI * 0.92);
      offset.setFromSpherical(spherical);
      camera.position.copy(target).add(offset);
      controlsRef.current.update();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [camera]);

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
      // Build a stable-sorted list: stopped vehicles first, then most-delayed
      // first. Keeps ordering deterministic across frames so the cycle is
      // predictable.
      const list = Array.from(trains.values())
        .filter((t) => t.status !== "ok")
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === "stopped" ? -1 : 1;
          return (b.delay ?? 0) - (a.delay ?? 0);
        });

      if (list.length > 0) {
        const dwell = anomalyDwell.current;
        const now = Date.now();
        const currentIdx = dwell.id ? list.findIndex((t) => t.id === dwell.id) : -1;
        const expired = now - dwell.since > ANOMALY_DWELL_MS;
        if (currentIdx < 0 || expired) {
          const nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % list.length;
          const next = list[nextIdx];
          dwell.id = next.id;
          dwell.since = now;
          // Popping the InfoPanel is how the user actually reads the anomaly
          // detail; do it synchronously when we switch target.
          setSelectedTrain(next.id);
        }
        const current = list.find((t) => t.id === dwell.id) ?? list[0];
        const [x, y, z] = projection.projectArray({ lat: current.lat, lon: current.lon, depth: current.depth });
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
      } else {
        // No anomalies right now — fall back to the overview preset camera.
        anomalyDwell.current = { id: null, since: 0 };
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
        // Hold shift to swap the left mouse button from pan to rotate — the
        // right mouse button always rotates for users who have that option.
        LEFT: shiftHeld ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
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
      maxDistance={2400}
      maxPolarAngle={Math.PI * 0.92}
      minPolarAngle={0.05}
      dampingFactor={0.08}
      enableDamping
    />
  );
}
