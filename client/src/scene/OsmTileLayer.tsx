import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import type { Network } from "../data/types";
import type { Projection } from "../data/projection";
import { useAppStore } from "../data/store";

interface Props {
  network: Network;
  projection: Projection;
}

// CartoDB Dark Matter (no labels) matches our aesthetic. Free tier for
// non-commercial use; attribution string shown in the footer.
const TILE_URL = (z: number, x: number, y: number) =>
  `https://a.basemaps.cartocdn.com/dark_nolabels/${z}/${x}/${y}.png`;

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

function chooseZoom(spanKm: number) {
  if (spanKm < 30) return 11;
  if (spanKm < 70) return 10;
  if (spanKm < 150) return 9;
  if (spanKm < 300) return 8;
  return 7;
}

function bboxOfStations(network: Network) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const s of network.stations) {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lon < minLon) minLon = s.lon;
    if (s.lon > maxLon) maxLon = s.lon;
  }
  // Pad 10% so tiles cover a bit beyond the network.
  const padLat = Math.max(0.05, (maxLat - minLat) * 0.1);
  const padLon = Math.max(0.05, (maxLon - minLon) * 0.1);
  return {
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
    minLon: minLon - padLon,
    maxLon: maxLon + padLon,
  };
}

export function OsmTileLayer({ network, projection }: Props) {
  const showBasemap = useAppStore((s) => s.showBasemap);

  const tiles = useMemo(() => {
    const bbox = bboxOfStations(network);
    const centerLat = (bbox.minLat + bbox.maxLat) / 2;
    // Approximate span in km for zoom selection.
    const latKm = (bbox.maxLat - bbox.minLat) * 110.574;
    const lonKm = (bbox.maxLon - bbox.minLon) * 111.320 * Math.cos((centerLat * Math.PI) / 180);
    const spanKm = Math.max(latKm, lonKm);
    const z = chooseZoom(spanKm);

    const nw = lonLatToTile(bbox.maxLat, bbox.minLon, z);
    const se = lonLatToTile(bbox.minLat, bbox.maxLon, z);
    const out: { url: string; corners: [number, number, number][] }[] = [];
    for (let x = nw.x; x <= se.x; x++) {
      for (let y = nw.y; y <= se.y; y++) {
        const topLeft = tileToLonLat(x, y, z);
        const bottomRight = tileToLonLat(x + 1, y + 1, z);
        // Plane positions in scene space for the four corners.
        const tl = projection.projectArray({ lat: topLeft.lat, lon: topLeft.lon, depth: 0 });
        const tr = projection.projectArray({ lat: topLeft.lat, lon: bottomRight.lon, depth: 0 });
        const bl = projection.projectArray({ lat: bottomRight.lat, lon: topLeft.lon, depth: 0 });
        const br = projection.projectArray({ lat: bottomRight.lat, lon: bottomRight.lon, depth: 0 });
        out.push({ url: TILE_URL(z, x, y), corners: [tl, tr, bl, br] });
      }
    }
    return out;
  }, [network, projection]);

  if (!showBasemap || !tiles.length) return null;

  return (
    <group>
      {tiles.map((t) => (
        <OsmTile key={t.url} url={t.url} corners={t.corners} />
      ))}
    </group>
  );
}

function OsmTile({ url, corners }: { url: string; corners: [number, number, number][] }) {
  const texture = useLoader(THREE.TextureLoader, url);
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const geo = useMemo(() => {
    const [tl, tr, bl, br] = corners;
    const g = new THREE.BufferGeometry();
    const y = 0.01; // slightly above ground grid so it composites on top
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
    <mesh geometry={geo}>
      <meshBasicMaterial map={texture} transparent opacity={0.55} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
