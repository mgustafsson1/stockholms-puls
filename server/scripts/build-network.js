import { readFileSync, writeFileSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = "/Users/andersbj/Projekt/delay-heatmap/data";
const STOP_TIMES = "/tmp/gtfs-stockholm/stop_times.txt";
const OUT_NETWORK = resolve(__dirname, "../data/network.json");
const OUT_TRIPS = resolve(__dirname, "../data/trip-lines.json");
const SUBWAY_TRIPS = resolve(__dirname, "../data/subway-trips.json");

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

function modeFromRouteType(rt, longName, shortName) {
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

// 1. Parse routes.txt
console.log("[1/6] reading routes.txt");
const routes = new Map();
for (const line of readFileSync(`${SRC}/routes.txt`, "utf8").split("\n").slice(1)) {
  if (!line) continue;
  const p = parseCsvLine(line);
  const [route_id, , short, long, route_type] = p;
  if (!route_id?.startsWith("9011001")) continue;
  const rt = Number(route_type);
  const mode = modeFromRouteType(rt, long, short);
  if (!mode) continue;
  if (mode === "subway") continue; // keep existing
  const prefix = mode === "rail" ? "J" : mode === "lightrail" ? "L" : mode === "tram" ? "S" : mode === "ferry" ? "B" : "T";
  routes.set(route_id, {
    route_id, mode, short, long,
    color: colorFor(mode, short, long),
    lineId: `${prefix}${short}`,
  });
}
console.log(`  → ${routes.size} non-subway SL routes`);

// 2. Parse trips.txt, keep all trips for our routes (for trip-lines mapping),
//    and a small sample per (route, direction) for building canonical sequences.
console.log("[2/6] reading trips.txt");
const tripLookup = new Map();
const sampleTrips = new Set();
const perRouteDir = new Map();
for (const line of readFileSync(`${SRC}/trips.txt`, "utf8").split("\n").slice(1)) {
  if (!line) continue;
  const p = parseCsvLine(line);
  const [route_id, , trip_id, , direction_id] = p;
  if (!routes.has(route_id)) continue;
  tripLookup.set(trip_id, { route_id, direction_id });
  const key = `${route_id}|${direction_id}`;
  const n = perRouteDir.get(key) ?? 0;
  if (n < 20) sampleTrips.add(trip_id);
  perRouteDir.set(key, n + 1);
}
console.log(`  → ${tripLookup.size} total trip mappings, ${sampleTrips.size} sample trips`);

// 3. Stream stop_times.txt for sample trips
console.log("[3/6] streaming stop_times.txt (large)");
const tripStops = new Map();
const rl = createInterface({ input: createReadStream(STOP_TIMES) });
let seen = 0;
let header = true;
for await (const line of rl) {
  if (header) { header = false; continue; }
  if (!line) continue;
  const commaIdx = line.indexOf(",");
  const tid = line.slice(0, commaIdx);
  if (!sampleTrips.has(tid)) continue;
  const parts = parseCsvLine(line);
  const stop_id = parts[3];
  const stop_sequence = Number(parts[4]);
  let arr = tripStops.get(tid);
  if (!arr) { arr = []; tripStops.set(tid, arr); }
  arr.push({ seq: stop_sequence, stop_id });
  seen++;
}
console.log(`  → ${seen} matching stop_time rows for ${tripStops.size} trips`);

// 4. Pick the trip with the most stops per (route, direction)
const canonicalByRouteDir = new Map();
for (const [tid, seq] of tripStops) {
  seq.sort((a, b) => a.seq - b.seq);
  const t = tripLookup.get(tid);
  if (!t) continue;
  const key = `${t.route_id}|${t.direction_id}`;
  const existing = canonicalByRouteDir.get(key);
  if (!existing || seq.length > existing.length) {
    canonicalByRouteDir.set(key, seq.map((x) => x.stop_id));
  }
}

// 5. Parse stops.txt
console.log("[4/6] reading stops.txt");
const allStops = new Map();
for (const line of readFileSync(`${SRC}/stops.txt`, "utf8").split("\n").slice(1)) {
  if (!line) continue;
  const p = parseCsvLine(line);
  const [stop_id, stop_name, lat, lon, loc_type, parent] = p;
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

// 6. Build network (keep subway from existing file)
console.log("[5/6] building lines + stations");
const existing = JSON.parse(readFileSync(OUT_NETWORK, "utf8"));
const existingSubway = {
  stations: existing.stations.map((s) => ({ ...s, mode: s.mode ?? "subway" })),
  lines: existing.lines.map((l) => ({ ...l, mode: l.mode ?? "subway" })),
};

const BBOX = { minLat: 59.05, maxLat: 59.75, minLon: 17.55, maxLon: 18.55 };
const inBbox = (s) => s.lat >= BBOX.minLat && s.lat <= BBOX.maxLat && s.lon >= BBOX.minLon && s.lon <= BBOX.maxLon;

const newStations = new Map();
const newLines = [];
for (const [key, stopIds] of canonicalByRouteDir) {
  const [route_id, dir] = key.split("|");
  if (dir !== "0") continue; // one direction per route
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
console.log(`  → ${newStations.size} new stations, ${newLines.length} new lines`);

const merged = {
  origin: existing.origin,
  stations: [...existingSubway.stations, ...newStations.values()],
  lines: [...existingSubway.lines, ...newLines],
};
writeFileSync(OUT_NETWORK, JSON.stringify(merged, null, 2));

// 7. Build trip-lines.json — subway + non-subway
console.log("[6/6] writing trip-lines.json");
const tripLines = {};
const subwayColor = { T10: "#0f82c8", T11: "#0f82c8", T13: "#d42e2e", T14: "#d42e2e", T17: "#3aad5c", T18: "#3aad5c", T19: "#3aad5c" };
const subwayMap = JSON.parse(readFileSync(SUBWAY_TRIPS, "utf8"));
for (const [tid, name] of Object.entries(subwayMap)) {
  tripLines[tid] = { mode: "subway", lineId: name, color: subwayColor[name] || "#888" };
}
for (const [tid, info] of tripLookup) {
  const r = routes.get(info.route_id);
  tripLines[tid] = { mode: r.mode, lineId: r.lineId, color: r.color };
}
writeFileSync(OUT_TRIPS, JSON.stringify(tripLines));

console.log("\nDone.");
console.log(`  stations: ${merged.stations.length}`);
console.log(`  lines: ${merged.lines.length}`);
console.log(`  trip mappings: ${Object.keys(tripLines).length}`);
for (const mode of ["subway", "rail", "lightrail", "tram", "ferry"]) {
  const lines = merged.lines.filter((l) => l.mode === mode);
  console.log(`  ${mode}: ${lines.length} lines (${lines.map((l) => l.line).join(", ")})`);
}
