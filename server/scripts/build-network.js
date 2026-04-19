import { readFileSync, writeFileSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { REGIONS, regionById } from "../src/regions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = "/tmp/gtfs-sweden-fresh";
const STOP_TIMES = "/tmp/gtfs-sweden-fresh/stop_times.txt";
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const regionArg = args.find((a) => a.startsWith("--region="))?.split("=")[1];
const selected = regionArg ? [regionById(regionArg)].filter(Boolean) : REGIONS;
if (!selected.length) {
  console.error(`Unknown region: ${regionArg}`);
  process.exit(1);
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function modeFromRouteType(rt, longName) {
  if (rt === 401) return "subway";
  if (rt === 100) return "rail";
  if (rt === 1000) return "ferry";
  if (rt === 900) {
    const n = (longName || "").toLowerCase();
    if (n.includes("tvärbanan")) return "lightrail";
    if (n.includes("saltsjöbanan")) return "lightrail";
    if (n.includes("kårstalinjen") || n.includes("österskärslinjen") || n.includes("näsbyparkslinjen")) return "lightrail";
    return "tram";
  }
  return null;
}

function colorFor(mode, short, long) {
  if (mode === "subway") {
    if (short === "10" || short === "11") return "#0f82c8";
    if (short === "13" || short === "14") return "#d42e2e";
    return "#3aad5c";
  }
  if (mode === "rail") return "#ff7a1f";
  if (mode === "lightrail") {
    const l = (long || "").toLowerCase();
    if (l.includes("tvärbanan")) return "#b084ff";
    if (l.includes("saltsjöbanan")) return "#ff6fb5";
    return "#c266d9";
  }
  if (mode === "tram") return "#f4c430";
  if (mode === "ferry") return "#24d4d4";
  return "#888";
}

function prefixFor(mode) {
  if (mode === "rail") return "J";
  if (mode === "lightrail") return "L";
  if (mode === "tram") return "S";
  if (mode === "ferry") return "B";
  return "T";
}

function matchesOperator(routeId, prefixes) {
  return prefixes.some((p) => routeId.startsWith(p));
}

// ---------- Pass 1: routes.txt (shared across all regions) ----------
console.log("[1/6] reading routes.txt");
const routeLines = readFileSync(`${SRC}/routes.txt`, "utf8").split("\n").slice(1);
const routesAllRegions = new Map(); // regionId -> Map(route_id -> info)
for (const region of selected) {
  routesAllRegions.set(region.id, new Map());
}
for (const line of routeLines) {
  if (!line) continue;
  const p = parseCsvLine(line);
  const [route_id, , short, long, route_type] = p;
  const rt = Number(route_type);
  const mode = modeFromRouteType(rt, long);
  if (!mode) continue;
  for (const region of selected) {
    if (region.keepExistingSubway && mode === "subway") continue;
    if (!matchesOperator(route_id, region.operatorPrefixes)) continue;
    routesAllRegions.get(region.id).set(route_id, {
      route_id, mode, short, long,
      color: colorFor(mode, short, long),
      lineId: `${prefixFor(mode)}${short}`,
    });
  }
}
for (const region of selected) {
  console.log(`  → ${region.id}: ${routesAllRegions.get(region.id).size} non-bus routes`);
}

// ---------- Pass 2: trips.txt (find sample trips per route+dir) ----------
console.log("[2/6] reading trips.txt");
const tripsAllRegions = new Map(); // regionId -> { tripLookup: Map, sampleTrips: Set, perRouteDir: Map }
for (const region of selected) {
  tripsAllRegions.set(region.id, {
    tripLookup: new Map(),
    sampleTrips: new Set(),
    perRouteDir: new Map(),
  });
}
const tripsStream = readFileSync(`${SRC}/trips.txt`, "utf8").split("\n");
// Fresh GTFS Sweden-3 trips.txt columns:
//   route_id, service_id, trip_id, trip_headsign, trip_short_name,
//   direction_id, shape_id, samtrafiken_internal_trip_number
for (let i = 1; i < tripsStream.length; i++) {
  const line = tripsStream[i];
  if (!line) continue;
  const p = parseCsvLine(line);
  const route_id = p[0];
  const trip_id = p[2];
  const direction_id = p[5] ?? p[4] ?? "";
  for (const region of selected) {
    const routes = routesAllRegions.get(region.id);
    if (!routes.has(route_id)) continue;
    const rdata = tripsAllRegions.get(region.id);
    rdata.tripLookup.set(trip_id, { route_id, direction_id });
    const key = `${route_id}|${direction_id}`;
    const n = rdata.perRouteDir.get(key) ?? 0;
    if (n < 20) rdata.sampleTrips.add(trip_id);
    rdata.perRouteDir.set(key, n + 1);
  }
}
for (const region of selected) {
  const rdata = tripsAllRegions.get(region.id);
  console.log(`  → ${region.id}: ${rdata.tripLookup.size} trip mappings, ${rdata.sampleTrips.size} samples`);
}

// ---------- Pass 3: stream stop_times.txt for sample trips ----------
console.log("[3/6] streaming stop_times.txt (large)");
const allSampleTrips = new Set();
for (const r of selected) for (const t of tripsAllRegions.get(r.id).sampleTrips) allSampleTrips.add(t);
const tripStops = new Map();
const rl = createInterface({ input: createReadStream(STOP_TIMES) });
let seen = 0;
let header = true;
for await (const line of rl) {
  if (header) { header = false; continue; }
  if (!line) continue;
  const commaIdx = line.indexOf(",");
  const tid = line.slice(0, commaIdx);
  if (!allSampleTrips.has(tid)) continue;
  const parts = parseCsvLine(line);
  const stop_id = parts[3];
  const stop_sequence = Number(parts[4]);
  let arr = tripStops.get(tid);
  if (!arr) { arr = []; tripStops.set(tid, arr); }
  arr.push({ seq: stop_sequence, stop_id });
  seen++;
}
console.log(`  → ${seen} stop_time rows for ${tripStops.size} trips`);

// ---------- Pass 4: stops.txt ----------
console.log("[4/6] reading stops.txt");
const allStops = new Map();
for (const line of readFileSync(`${SRC}/stops.txt`, "utf8").split("\n").slice(1)) {
  if (!line) continue;
  const p = parseCsvLine(line);
  const [stop_id, stop_name, lat, lon, _loc, parent] = p;
  allStops.set(stop_id, {
    id: stop_id,
    name: stop_name,
    lat: Number(lat),
    lon: Number(lon),
    parent: parent || null,
  });
}
function resolveStation(sid) {
  const s = allStops.get(sid);
  if (!s) return null;
  if (s.parent) {
    const p = allStops.get(s.parent);
    if (p) return p;
  }
  return s;
}

// ---------- Pass 5: per-region assembly ----------
console.log("[5/6] building per-region networks");
for (const region of selected) {
  const routes = routesAllRegions.get(region.id);
  const rdata = tripsAllRegions.get(region.id);
  const tripLookup = rdata.tripLookup;

  // pick longest stop sequence per (route, direction)
  const canonicalByRouteDir = new Map();
  for (const [tid, arr] of tripStops) {
    if (!tripLookup.has(tid)) continue;
    arr.sort((a, b) => a.seq - b.seq);
    const t = tripLookup.get(tid);
    const key = `${t.route_id}|${t.direction_id}`;
    const existing = canonicalByRouteDir.get(key);
    if (!existing || arr.length > existing.length) {
      canonicalByRouteDir.set(key, arr.map((x) => x.stop_id));
    }
  }

  const bbox = region.bbox;
  const inBbox = (s) => s.lat >= bbox.minLat && s.lat <= bbox.maxLat && s.lon >= bbox.minLon && s.lon <= bbox.maxLon;

  const newStations = new Map();
  const newLines = [];
  for (const [key, stopIds] of canonicalByRouteDir) {
    const [route_id, dir] = key.split("|");
    if (dir !== "0") continue;
    const route = routes.get(route_id);
    if (!route) continue;
    const resolved = [];
    for (const sid of stopIds) {
      const st = resolveStation(sid);
      if (!st || !inBbox(st)) continue;
      if (resolved.length && resolved[resolved.length - 1] === st.id) continue;
      resolved.push(st.id);
      if (!newStations.has(st.id)) {
        newStations.set(st.id, {
          id: st.id,
          name: st.name,
          lat: st.lat,
          lon: st.lon,
          depth: 0,
          mode: route.mode,
        });
      }
    }
    if (resolved.length < 2) continue;
    newLines.push({
      id: route.lineId,
      line: route.short,
      name: route.long || route.short,
      color: route.color,
      mode: route.mode,
      stations: resolved,
    });
  }

  const outDir = resolve(ROOT, `data/regions/${region.id}`);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  let mergedStations = Array.from(newStations.values());
  let mergedLines = newLines;

  if (region.keepExistingSubway) {
    // Stockholm: merge hand-curated subway lines from data/network.json
    const subwayPath = resolve(ROOT, "data/network.json");
    if (existsSync(subwayPath)) {
      const existing = JSON.parse(readFileSync(subwayPath, "utf8"));
      const subwayStations = existing.stations
        .filter((s) => (s.mode ?? "subway") === "subway")
        .map((s) => ({ ...s, mode: "subway" }));
      const subwayLines = existing.lines
        .filter((l) => (l.mode ?? "subway") === "subway")
        .map((l) => ({ ...l, mode: "subway" }));
      mergedStations = [...subwayStations, ...mergedStations];
      mergedLines = [...subwayLines, ...mergedLines];
    }
  }

  const merged = {
    origin: region.origin,
    stations: mergedStations,
    lines: mergedLines,
  };
  writeFileSync(resolve(outDir, "network.json"), JSON.stringify(merged, null, 2));

  // trip-lines
  const tripLines = {};
  for (const [tid, info] of tripLookup) {
    const r = routes.get(info.route_id);
    if (!r) continue;
    tripLines[tid] = { mode: r.mode, lineId: r.lineId, color: r.color };
  }
  // Stockholm: also include subway trip mappings from old data/subway-trips.json
  if (region.keepExistingSubway) {
    const subwayPath = resolve(ROOT, "data/subway-trips.json");
    if (existsSync(subwayPath)) {
      const subwayColor = { T10: "#0f82c8", T11: "#0f82c8", T13: "#d42e2e", T14: "#d42e2e", T17: "#3aad5c", T18: "#3aad5c", T19: "#3aad5c" };
      const subwayMap = JSON.parse(readFileSync(subwayPath, "utf8"));
      for (const [tid, name] of Object.entries(subwayMap)) {
        tripLines[tid] = { mode: "subway", lineId: name, color: subwayColor[name] || "#888" };
      }
    }
  }
  writeFileSync(resolve(outDir, "trip-lines.json"), JSON.stringify(tripLines));

  const byMode = {};
  for (const l of merged.lines) byMode[l.mode] = (byMode[l.mode] ?? 0) + 1;
  console.log(`  → ${region.id}: stations=${merged.stations.length} lines=${merged.lines.length} trips=${Object.keys(tripLines).length}`);
  console.log(`      by mode:`, byMode);
}

console.log("[6/6] done.");
