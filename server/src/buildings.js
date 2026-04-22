// OSM Buildings proxy with disk-backed tile cache.
// Overpass is rate-limited (~2 concurrent, dozen queries per minute) so we
// aggressively cache per-tile queries. Client asks for a single tile; if we
// haven't seen it before we hit Overpass, parse to a compact shape, and
// persist as JSON under server/cache/buildings/ so that reloading the server
// doesn't re-fetch everything.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, "../cache/buildings");
mkdirSync(CACHE_DIR, { recursive: true });

// Cache entries are immutable (buildings don't move); 30 days TTL is plenty
// and keeps storage from growing unbounded.
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Overpass is happier with one concurrent query per client; a short in-memory
// queue keeps us from rejecting the simultaneous-clients request that arrives
// at cold start with a 429.
let inflight = Promise.resolve();

function tileToBbox(z, x, y) {
  const n = 2 ** z;
  const lonW = (x / n) * 360 - 180;
  const lonE = ((x + 1) / n) * 360 - 180;
  const latN = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const latS = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return { minLat: latS, maxLat: latN, minLon: lonW, maxLon: lonE };
}

// Estimate a building height. OSM is inconsistent — real `height` tag first,
// then levels × 3 m, then a small default so the city reads as 3D at all.
function estimateHeight(tags) {
  if (!tags) return 8;
  const raw = tags.height ?? tags["building:height"];
  if (raw) {
    const v = parseFloat(String(raw).replace(",", "."));
    if (Number.isFinite(v)) return Math.min(300, Math.max(3, v));
  }
  const levels = parseFloat(tags["building:levels"] ?? tags.levels ?? "");
  if (Number.isFinite(levels) && levels > 0) return Math.min(300, Math.max(3, levels * 3));
  const amenity = tags.amenity;
  if (amenity === "place_of_worship") return 20;
  return 8;
}

function compactFromOverpass(json) {
  const out = [];
  for (const el of json.elements ?? []) {
    if (el.type !== "way" || !el.geometry) continue;
    const t = el.tags ?? {};
    if (!t.building && !t["building:part"]) continue;
    const polygon = el.geometry.map((p) => [p.lat, p.lon]);
    if (polygon.length < 3) continue;
    out.push({
      id: el.id,
      polygon,
      height: estimateHeight(t),
      minHeight: t.min_height ? parseFloat(String(t.min_height).replace(",", ".")) : 0,
    });
  }
  return out;
}

async function queryOverpass(bbox) {
  const { minLat, maxLat, minLon, maxLon } = bbox;
  const q =
    `[out:json][timeout:25];
     way["building"](${minLat},${minLon},${maxLat},${maxLon});
     out geom tags;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "stockholms-puls/1.0 (github.com/fltman/stockholms-puls)",
    },
    body: "data=" + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error(`overpass HTTP ${res.status}`);
  return compactFromOverpass(await res.json());
}

export async function getBuildingsForTile(z, x, y) {
  // We use tile zoom 15 as the canonical cache key even when the client asks
  // for a different zoom. One tile at z=15 ≈ 1.2 km, small enough to keep
  // each cache file under 400 KB in Stockholm.
  if (z < 14) return []; // too zoomed out to show buildings at all
  const cacheKey = `15_${Math.floor(x / 2 ** (z - 15))}_${Math.floor(y / 2 ** (z - 15))}`;
  const cachePath = resolve(CACHE_DIR, `${cacheKey}.json`);

  if (existsSync(cachePath)) {
    try {
      // readFileSync was blocking the event loop for 5-20 ms per ~400 KB
      // tile. With 20+ tiles loading at startup that's hundreds of ms of
      // stalled HTTP responses elsewhere — enough to drive nginx 504s on a
      // 1-CPU box. Async read lets other requests interleave.
      const raw = JSON.parse(await readFile(cachePath, "utf8"));
      if (raw.fetchedAt && Date.now() - raw.fetchedAt < TTL_MS) {
        return raw.buildings;
      }
    } catch {}
  }

  // Serialise Overpass calls behind an inflight chain — keeps polite clients
  // from dogpiling. 300 ms gap between queries is well within the rate limit.
  const wait = inflight.then(() => new Promise((r) => setTimeout(r, 300)));
  inflight = wait;
  await wait;

  const [tileX, tileY] = cacheKey.split("_").slice(1).map(Number);
  const bbox = tileToBbox(15, tileX, tileY);
  const buildings = await queryOverpass(bbox);
  try {
    await writeFile(cachePath, JSON.stringify({ fetchedAt: Date.now(), buildings }));
  } catch (err) {
    console.warn("[buildings] cache write failed:", err.message);
  }
  return buildings;
}
