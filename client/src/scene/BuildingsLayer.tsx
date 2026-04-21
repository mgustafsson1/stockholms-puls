import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Projection } from "../data/projection";
import { useAppStore } from "../data/store";

interface Building {
  id: number;
  polygon: [number, number][]; // [lat, lon][]
  height: number;
  minHeight: number;
}

interface TileLoad {
  key: string;
  status: "loading" | "ready" | "failed";
  mesh?: THREE.Mesh | null;
}

// Scene-unit conversion: the projection's horizontal scale is 1/300 (see
// projection.ts), so one scene unit ≈ 300 m on the ground. Building heights
// in metres need the same conversion to feel proportional.
const HEIGHT_SCALE = 1 / 300;

// OSM buildings only make sense zoomed in — skip rendering when the camera
// is further than this many scene units from its ground focus.
const MAX_CAMERA_HEIGHT = 10;

// Which zoom level we request buildings at. Coarser than the OSM tiles on the
// ground plane — one building-tile covers multiple map-tiles.
const BUILDINGS_Z = 15;

function lonLatToTile(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

function cameraGroundFocus(camera: THREE.Camera, fallback: THREE.Vector3) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  if (Math.abs(dir.y) < 1e-4) return fallback;
  const t = -camera.position.y / dir.y;
  if (!Number.isFinite(t) || t < 0) return fallback;
  return new THREE.Vector3(
    camera.position.x + dir.x * t,
    0,
    camera.position.z + dir.z * t
  );
}

// Build a single extruded mesh for a list of buildings. Merging into one
// geometry avoids a per-building draw call which would crush perf with 10k
// buildings in Stockholm.
function buildMergedMesh(buildings: Building[], projection: Projection): THREE.Mesh | null {
  const geometries: THREE.BufferGeometry[] = [];
  for (const b of buildings) {
    if (b.polygon.length < 3) continue;
    // Project each vertex into scene space (x,z in units; we handle height in
    // y ourselves below).
    const shape = new THREE.Shape();
    let first = true;
    for (const [lat, lon] of b.polygon) {
      const [x, , z] = projection.projectArray({ lat, lon, depth: 0 });
      if (first) { shape.moveTo(x, z); first = false; }
      else shape.lineTo(x, z);
    }
    const topH = (b.height ?? 8) * HEIGHT_SCALE;
    const botH = (b.minHeight ?? 0) * HEIGHT_SCALE;
    try {
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.002, topH - botH),
        bevelEnabled: false,
        steps: 1,
        curveSegments: 2,
      });
      // ExtrudeGeometry extrudes along +z from a 2D shape on XY. Rotate so
      // extrusion points up (+y), and lift by minHeight.
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0.04 + botH, 0); // keep above OSM tile plane (y=0.02)
      geometries.push(g);
    } catch {
      // Shape had self-intersections or a degenerate polygon — skip it.
    }
  }
  if (geometries.length === 0) return null;

  const merged = mergeGeometries(geometries, false);
  if (!merged) return null;
  merged.computeVertexNormals();
  geometries.forEach((g) => g.dispose());
  const material = new THREE.MeshStandardMaterial({
    color: "#2a3852",
    emissive: "#0b1422",
    emissiveIntensity: 0.8,
    roughness: 0.75,
    metalness: 0.05,
    transparent: true,
    opacity: 0.85,
    fog: false,
    toneMapped: false,
  });
  return new THREE.Mesh(merged, material);
}

export function BuildingsLayer({ projection }: { projection: Projection }) {
  const { camera } = useThree();
  const showBasemap = useAppStore((s) => s.showBasemap);
  const [tileKeys, setTileKeys] = useState<Set<string>>(() => new Set());
  const loadsRef = useRef<Map<string, TileLoad>>(new Map());
  const groupRef = useRef<THREE.Group>(null);
  const fallback = useRef(new THREE.Vector3(0, 0, 0));
  // Track camera-driven LOD on every frame but only React-setState when the
  // set of tiles to show actually changes — otherwise we'd rebuild meshes
  // continuously.
  useFrame(() => {
    if (!showBasemap) {
      if (tileKeys.size > 0) setTileKeys(new Set());
      return;
    }
    const focus = cameraGroundFocus(camera, fallback.current);
    const camHeight = Math.hypot(camera.position.x - focus.x, camera.position.y, camera.position.z - focus.z);
    if (camHeight > MAX_CAMERA_HEIGHT) {
      if (tileKeys.size > 0) setTileKeys(new Set());
      return;
    }
    const { lat, lon } = projection.unproject(focus.x, 0, focus.z);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const center = lonLatToTile(lat, lon, BUILDINGS_Z);
    const wanted = new Set<string>();
    // One tile in each direction: 3×3 grid. z=15 tile ≈ 1.2 km so 3×3 ≈ 3.6 km
    // which easily covers the zoom-in range before LOD kicks out.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        wanted.add(`${BUILDINGS_Z}/${center.x + dx}/${center.y + dy}`);
      }
    }
    const same =
      wanted.size === tileKeys.size && [...wanted].every((k) => tileKeys.has(k));
    if (!same) setTileKeys(wanted);
  });

  // Fetch any new tiles that appeared in tileKeys.
  useEffect(() => {
    const loads = loadsRef.current;
    let cancelled = false;

    // Drop meshes for tiles that left the window.
    for (const [key, load] of loads) {
      if (!tileKeys.has(key)) {
        if (load.mesh) {
          load.mesh.geometry.dispose();
          (load.mesh.material as THREE.Material).dispose();
          groupRef.current?.remove(load.mesh);
        }
        loads.delete(key);
      }
    }

    // Kick off fetches for new tiles.
    for (const key of tileKeys) {
      if (loads.has(key)) continue;
      loads.set(key, { key, status: "loading" });
      const [z, x, y] = key.split("/");
      (async () => {
        try {
          const res = await fetch(`/api/buildings/${z}/${x}/${y}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { buildings: Building[] };
          if (cancelled) return;
          const mesh = buildMergedMesh(data.buildings ?? [], projection);
          const load = loads.get(key);
          if (!load) return;
          load.status = "ready";
          load.mesh = mesh ?? null;
          if (mesh && groupRef.current) groupRef.current.add(mesh);
        } catch {
          const load = loads.get(key);
          if (load) load.status = "failed";
        }
      })();
    }
    return () => { cancelled = true; };
  }, [tileKeys, projection]);

  // Cleanup everything on unmount.
  useEffect(() => {
    return () => {
      const loads = loadsRef.current;
      for (const load of loads.values()) {
        if (load.mesh) {
          load.mesh.geometry.dispose();
          (load.mesh.material as THREE.Material).dispose();
        }
      }
      loads.clear();
    };
  }, []);

  return <group ref={groupRef} />;
}
