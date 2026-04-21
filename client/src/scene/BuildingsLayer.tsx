import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
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

// Triangulate a simple 2D polygon (x, z pairs) by picking the centroid as a
// fan anchor. Good enough for building outlines since most are convex or
// mildly concave — we accept slight errors on deeply concave cases rather
// than pulling in earcut.
function triangulateFan(pts: [number, number][]): number[][] {
  let cx = 0;
  let cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length;
  cz /= pts.length;
  const tris: number[][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    tris.push([cx, cz, a[0], a[1], b[0], b[1]]);
  }
  return tris;
}

// Build walls + roofs for a list of buildings. Walls occlude from the side,
// roofs close the top — with a transparent material they still let the OSM
// labels show through from directly above.
function buildBuildingsGeometry(
  buildings: Building[],
  projection: Projection,
  heightScale: number
): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const b of buildings) {
    if (b.polygon.length < 3) continue;
    const topY = 0.04 + (b.height ?? 8) * HEIGHT_SCALE * heightScale;
    const botY = 0.04 + (b.minHeight ?? 0) * HEIGHT_SCALE * heightScale;
    if (topY - botY < 0.005) continue;
    const projected = b.polygon.map(([lat, lon]) => {
      const [x, , z] = projection.projectArray({ lat, lon, depth: 0 });
      return [x, z] as [number, number];
    });

    // Walls.
    for (let i = 0; i < projected.length; i++) {
      const [ax, az] = projected[i];
      const [bx, bz] = projected[(i + 1) % projected.length];
      const ex = bx - ax;
      const ez = bz - az;
      const nl = Math.hypot(ex, ez) || 1;
      const nx = ez / nl;
      const nz = -ex / nl;
      positions.push(
        ax, botY, az,
        bx, botY, bz,
        ax, topY, az,
        bx, botY, bz,
        bx, topY, bz,
        ax, topY, az,
      );
      for (let k = 0; k < 6; k++) normals.push(nx, 0, nz);
    }

    // Roof — fan-triangulated around the centroid.
    const tris = triangulateFan(projected);
    for (const [cx, cz, ax, az, bx, bz] of tris) {
      positions.push(cx, topY, cz, ax, topY, az, bx, topY, bz);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
  }
  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geo;
}

// Darken a hex colour toward near-black so the emissive stays subtle without
// killing the user-picked hue.
function darken(hex: string, factor: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = Math.round(parseInt(m[1], 16) * factor);
  const g = Math.round(parseInt(m[2], 16) * factor);
  const b = Math.round(parseInt(m[3], 16) * factor);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function buildMergedMesh(
  buildings: Building[],
  projection: Projection,
  opacity: number,
  heightScale: number,
  color: string,
): THREE.Mesh | null {
  const geo = buildBuildingsGeometry(buildings, projection, heightScale);
  if (!geo) return null;
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: darken(color, 0.25),
    emissiveIntensity: 0.9,
    roughness: 0.75,
    metalness: 0.05,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
    depthWrite: false,
  });
  return new THREE.Mesh(geo, material);
}

export function BuildingsLayer({ projection }: { projection: Projection }) {
  const { camera } = useThree();
  const showBuildings = useAppStore((s) => s.showBuildings);
  const opacity = useAppStore((s) => s.buildingsOpacity);
  const heightScale = useAppStore((s) => s.buildingsHeightScale);
  const color = useAppStore((s) => s.buildingsColor);
  const [tileKeys, setTileKeys] = useState<Set<string>>(() => new Set());
  const loadsRef = useRef<Map<string, TileLoad>>(new Map());
  const rawRef = useRef<Map<string, Building[]>>(new Map());
  const groupRef = useRef<THREE.Group>(null);
  const fallback = useRef(new THREE.Vector3(0, 0, 0));
  // Track camera-driven LOD on every frame but only React-setState when the
  // set of tiles to show actually changes — otherwise we'd rebuild meshes
  // continuously.
  useFrame(() => {
    if (!showBuildings) {
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

  // Fetch any new tiles that appeared in tileKeys; rebuild meshes whenever
  // opacity or heightScale changes so the sliders feel live.
  useEffect(() => {
    const loads = loadsRef.current;
    const raw = rawRef.current;
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
        raw.delete(key);
      }
    }

    const installMesh = (key: string) => {
      const data = raw.get(key);
      if (!data) return;
      const existing = loads.get(key);
      if (existing?.mesh) {
        existing.mesh.geometry.dispose();
        (existing.mesh.material as THREE.Material).dispose();
        groupRef.current?.remove(existing.mesh);
      }
      const mesh = buildMergedMesh(data, projection, opacity, heightScale, color);
      loads.set(key, { key, status: "ready", mesh });
      if (mesh && groupRef.current) groupRef.current.add(mesh);
    };

    // Rebuild any already-fetched tile meshes against the new params.
    for (const key of tileKeys) {
      if (raw.has(key)) installMesh(key);
    }

    // Kick off fetches for tiles we haven't seen yet.
    for (const key of tileKeys) {
      if (loads.has(key) || raw.has(key)) continue;
      loads.set(key, { key, status: "loading" });
      const [z, x, y] = key.split("/");
      (async () => {
        try {
          const res = await fetch(`/api/buildings/${z}/${x}/${y}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { buildings: Building[] };
          if (cancelled) return;
          raw.set(key, data.buildings ?? []);
          installMesh(key);
        } catch {
          const load = loads.get(key);
          if (load) load.status = "failed";
        }
      })();
    }
    return () => { cancelled = true; };
  }, [tileKeys, projection, opacity, heightScale, color]);

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
