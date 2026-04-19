import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Network } from "../data/types";
import type { Projection } from "../data/projection";
import { useAppStore } from "../data/store";

interface Props {
  network: Network;
  projection: Projection;
}

// CartoDB Dark Matter: desaturated, nearly black tiles — fits the dashboard
// aesthetic and doesn't feed bloom.
const TILE_URL = (z: number, x: number, y: number) =>
  `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;

function lonLatToTile(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

function tileToLonLat(x: number, y: number, z: number) {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lat, lon };
}

// Web-mercator zoom level chosen from the height the camera sits above the
// ground focus plane. Lower height → more detail.
function zoomFromHeight(height: number) {
  const h = Math.max(1, height);
  if (h < 3) return 15;
  if (h < 5) return 14;
  if (h < 9) return 13;
  if (h < 16) return 12;
  if (h < 28) return 11;
  if (h < 48) return 10;
  if (h < 80) return 9;
  if (h < 140) return 8;
  return 7;
}

// How many tiles to load in each axis around the focus tile. More tiles ==
// more CDN load but a larger visible patch. At high zoom we need more tiles
// to fill the viewport; at low zoom each tile covers hundreds of km so a
// small ring is plenty (and keeps us under CDN rate limits).
function ringForZoom(z: number) {
  if (z >= 14) return 4;   //  9 × 9 =  81
  if (z >= 12) return 5;   // 11 × 11 = 121
  if (z >= 10) return 5;   // 11 × 11 = 121
  if (z >= 9)  return 4;   //  9 × 9 =  81
  if (z >= 8)  return 3;   //  7 × 7 =  49
  return 2;                //  5 × 5 =  25
}

function cameraGroundFocus(camera: THREE.Camera, fallback: THREE.Vector3) {
  // Intersect the camera's forward ray with the y=0 ground plane. If the
  // camera is looking up or parallel to the ground, we fall back to the scene
  // origin so we never hand back NaN to the projector.
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  if (Math.abs(dir.y) < 1e-4) return fallback;
  const t = -camera.position.y / dir.y;
  if (!Number.isFinite(t) || t < 0) return fallback;
  return new THREE.Vector3(
    camera.position.x + dir.x * t,
    0,
    camera.position.z + dir.z * t,
  );
}

export function OsmTileLayer({ network, projection }: Props) {
  const showBasemap = useAppStore((s) => s.showBasemap);
  const { camera } = useThree();

  // Reactive state we want to rebuild tiles on: zoom and the focus-tile index
  // at that zoom. Using tile-index granularity means we only rerun the memo
  // when the user pans far enough to cross a tile boundary.
  const [viewKey, setViewKey] = useState<{ z: number; tx: number; ty: number }>(() => ({ z: 11, tx: 0, ty: 0 }));
  const fallback = useRef(new THREE.Vector3(0, 0, 0));

  useFrame(() => {
    const focus = cameraGroundFocus(camera, fallback.current);
    const h = Math.max(1, Math.hypot(camera.position.x - focus.x, camera.position.y, camera.position.z - focus.z));
    const z = zoomFromHeight(h);
    const { lat, lon } = projection.unproject(focus.x, 0, focus.z);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const { x: tx, y: ty } = lonLatToTile(lat, lon, z);
    if (z !== viewKey.z || tx !== viewKey.tx || ty !== viewKey.ty) {
      setViewKey({ z, tx, ty });
    }
  });

  const tiles = useMemo(() => {
    if (!showBasemap) return [];
    const { z, tx, ty } = viewKey;
    const ring = ringForZoom(z);
    const maxTiles = 2 ** z; // world wrap at current zoom
    const out: { url: string; corners: [number, number, number][]; key: string }[] = [];
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        const x = tx + dx;
        const y = ty + dy;
        if (y < 0 || y >= maxTiles) continue; // mercator is vertically clamped
        const wrappedX = ((x % maxTiles) + maxTiles) % maxTiles;
        const topLeft = tileToLonLat(x, y, z);
        const bottomRight = tileToLonLat(x + 1, y + 1, z);
        const tl = projection.projectArray({ lat: topLeft.lat, lon: topLeft.lon, depth: 0 });
        const tr = projection.projectArray({ lat: topLeft.lat, lon: bottomRight.lon, depth: 0 });
        const bl = projection.projectArray({ lat: bottomRight.lat, lon: topLeft.lon, depth: 0 });
        const br = projection.projectArray({ lat: bottomRight.lat, lon: bottomRight.lon, depth: 0 });
        out.push({
          url: TILE_URL(z, wrappedX, y),
          corners: [tl, tr, bl, br],
          key: `${z}/${wrappedX}/${y}`,
        });
      }
    }
    return out;
  }, [projection, showBasemap, viewKey]);

  if (!showBasemap || tiles.length === 0) return null;

  return (
    <group>
      {tiles.map((t) => (
        <OsmTile key={t.key} url={t.url} corners={t.corners} />
      ))}
    </group>
  );
}

function OsmTile({ url, corners }: { url: string; corners: [number, number, number][] }) {
  const texture = useLoader(THREE.TextureLoader, url);
  useEffect(() => {
    texture.anisotropy = 16;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }, [texture]);

  const geo = useMemo(() => {
    const [tl, tr, bl, br] = corners;
    const g = new THREE.BufferGeometry();
    const y = 0.02;
    const positions = new Float32Array([
      tl[0], y, tl[2],
      tr[0], y, tr[2],
      br[0], y, br[2],
      bl[0], y, bl[2],
    ]);
    const uvs = new Float32Array([
      0, 1,
      1, 1,
      1, 0,
      0, 0,
    ]);
    const indices = new Uint16Array([0, 2, 1, 0, 3, 2]);
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeVertexNormals();
    return g;
  }, [corners]);

  return (
    <mesh geometry={geo} renderOrder={-10}>
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={0.95}
        toneMapped={false}
        depthWrite={false}
        // The scene uses a short-range fog (40→160) to keep the transit
        // network feeling close. That fog fades tiles to pitch black the
        // moment you dolly out, which is exactly what the user was seeing.
        // Opt the tile plane out so the map stays visible at any distance.
        fog={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
