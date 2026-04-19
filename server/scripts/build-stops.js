#!/usr/bin/env node
// Extracts bus/other stop locations per region from GTFS Sweden-3's stops.txt
// and writes them to data/regions/<region>/stops.json. Rail/metro/tram/ferry
// stations already live in network.json; this file adds the rest so search
// can find bus stops.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { REGIONS, regionById } from "../src/regions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = "/tmp/gtfs-sweden-fresh";
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const regionArg = args.find((a) => a.startsWith("--region="))?.split("=")[1];
const selected = regionArg ? [regionById(regionArg)].filter(Boolean) : REGIONS;
if (!selected.length) {
  console.error(`Unknown region: ${regionArg}`);
  process.exit(1);
}
if (!existsSync(`${SRC}/stops.txt`)) {
  console.error(`GTFS source missing at ${SRC} — aborting.`);
  process.exit(1);
}

function parseCsvLine(line) {
  // stops.txt uses Windows CRLF line endings; strip trailing \r from the last
  // field so "platform_code" and similar columns match cleanly.
  const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '"') {
      if (inQ && clean[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) {
      out.push(cur); cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function norm(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Load each region's existing rail/metro station names so we can dedupe.
const regionState = new Map();
for (const region of selected) {
  const networkPath = resolve(ROOT, `data/regions/${region.id}/network.json`);
  if (!existsSync(networkPath)) continue;
  const net = JSON.parse(readFileSync(networkPath, "utf8"));
  regionState.set(region.id, {
    region,
    net,
    existingNames: new Set(net.stations.map((s) => norm(s.name))),
    out: [],
    seenNames: new Set(),
  });
}

console.log(`[stops] reading stops.txt (region count: ${regionState.size})`);
const lines = readFileSync(`${SRC}/stops.txt`, "utf8").split("\n");
const header = parseCsvLine(lines[0] || "");
// Find column indices by header name so we don't break on schema shifts.
function idx(name) {
  const i = header.indexOf(name);
  return i < 0 ? null : i;
}
const iId = idx("stop_id");
const iName = idx("stop_name");
const iLat = idx("stop_lat");
const iLon = idx("stop_lon");
const iLocType = idx("location_type"); // 0 = stop, 1 = station, 2 = entrance
const iParent = idx("parent_station");
if (iId == null || iName == null || iLat == null || iLon == null) {
  console.error("stops.txt missing required columns", header);
  process.exit(1);
}

let examined = 0;
for (let k = 1; k < lines.length; k++) {
  const line = lines[k];
  if (!line) continue;
  const p = parseCsvLine(line);
  examined++;
  const locType = iLocType != null ? p[iLocType] : "";
  // In GTFS Sweden-3, named user-facing stops are location_type=1 (parent
  // station, whether that's Stockholm C or a single bus quay "Tallhagen").
  // location_type=0 rows are individual platform/quay positions under a
  // parent and duplicate the named stop many times — skip them.
  // Blank location_type is treated as "0" by the GTFS spec, so also skip.
  if (locType !== "1") continue;

  const name = p[iName];
  const lat = Number(p[iLat]);
  const lon = Number(p[iLon]);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

  for (const state of regionState.values()) {
    const b = state.region.bbox;
    if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) continue;
    const key = norm(name);
    if (state.existingNames.has(key) || state.seenNames.has(key)) continue;
    state.seenNames.add(key);
    state.out.push({ id: p[iId], name, lat, lon });
  }
}
console.log(`  examined ${examined} stops`);

for (const state of regionState.values()) {
  const outPath = resolve(ROOT, `data/regions/${state.region.id}/stops.json`);
  writeFileSync(outPath, JSON.stringify(state.out));
  console.log(`[${state.region.id}] wrote ${state.out.length} extra stops`);
}
