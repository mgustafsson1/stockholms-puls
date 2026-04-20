import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load server/.env before any module reads process.env (so AIAnalyst / the
// Trafiklab-RT proxy can pick up keys set there). `--env-file` in npm
// scripts handles this on a fresh start, but when running via `node --watch`
// without the flag we do it ourselves so the dev loop keeps working.
{
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
  if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
    try { process.loadEnvFile(envPath); } catch {}
  }
}

import { Simulator } from "./simulator.js";
import { LiveSource, hasTrafiklabKey } from "./liveSource.js";
import { AIAnalyst } from "./aiAnalyst.js";
import { TrendRecorder } from "./trendRecorder.js";
import { HistoryRecorder } from "./historyRecorder.js";
import { ChronicDelayTracker } from "./chronicDelays.js";
import { REGIONS } from "./regions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGION = "stockholm";

function loadRegionData(regionId) {
  const networkPath = resolve(__dirname, `../data/regions/${regionId}/network.json`);
  const tripMapPath = resolve(__dirname, `../data/regions/${regionId}/trip-lines.json`);
  const network = JSON.parse(readFileSync(networkPath, "utf8"));
  return { network, tripMapPath };
}

const PORT = Number(process.env.PORT ?? 4000);
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const startTime = Date.now();
const usingLive = hasTrafiklabKey();

// Build one source per region (live or simulator).
const sources = new Map();
const networks = new Map();
for (const region of REGIONS) {
  try {
    const { network, tripMapPath } = loadRegionData(region.id);
    networks.set(region.id, network);
    const source = usingLive
      ? new LiveSource(network, {
          regionId: region.id,
          label: region.label,
          operator: region.operator,
          operators: region.operators,
          bbox: region.operators ? region.bbox : null,
          tripMapPath: region.useTripMap === false ? null : tripMapPath,
          maxMatchMeters: region.matchMaxMeters,
          maxMatchMetersForced: region.matchMaxMetersForced,
          ferryMaxMeters: region.ferryMaxMeters,
        })
      : new Simulator(network);
    sources.set(region.id, source);
    console.log(`[region:${region.id}] ${region.label} — ${network.lines.length} lines, ${network.stations.length} stations`);
  } catch (err) {
    console.warn(`[region:${region.id}] skipped (${err.message})`);
  }
}
if (!sources.has(DEFAULT_REGION)) {
  console.error(`Default region "${DEFAULT_REGION}" unavailable.`);
  process.exit(1);
}

// One AIAnalyst per region, lazily started via acquire/release based on
// active WS subscribers. A region with no viewers does not burn LLM credits.
const aiAnalysts = new Map();
for (const region of REGIONS) {
  if (!sources.has(region.id)) continue;
  aiAnalysts.set(region.id, new AIAnalyst({
    regionId: region.id,
    regionLabel: region.label,
    getSnapshot: () => sources.get(region.id).snapshot(),
    network: networks.get(region.id),
    intervalMs: Number(process.env.AI_INTERVAL_MS ?? 90_000),
  }));
}
const aiEnabled = !![...aiAnalysts.values()][0]?.apiKey;

const trendRecorders = new Map();
const historyRecorders = new Map();
const chronicTrackers = new Map();
for (const [id, source] of sources) {
  trendRecorders.set(id, new TrendRecorder({
    regionId: id,
    network: networks.get(id),
    getSnapshot: () => source.snapshot(),
    intervalMs: Number(process.env.TREND_INTERVAL_MS ?? 30_000),
    maxSamples: 120,
  }));
  historyRecorders.set(id, new HistoryRecorder({
    regionId: id,
    getSnapshot: () => source.snapshot(),
    intervalMs: Number(process.env.HISTORY_INTERVAL_MS ?? 60_000),
    maxSamples: Number(process.env.HISTORY_MAX_SAMPLES ?? 180), // 3 h at 1 min
  }));
  const chronic = new ChronicDelayTracker({
    regionId: id,
    persistPath: resolve(__dirname, `../data/regions/${id}/chronic-delays.json`),
  });
  chronicTrackers.set(id, chronic);
  // Observe every snapshot the source emits so scores update at poll cadence
  // without a separate timer.
  source.on((snap) => chronic.observe(snap));
}

app.post("/api/_snapshot", async (req, res) => {
  const { data, name } = req.body ?? {};
  if (!data || typeof data !== "string") return res.status(400).json({ error: "bad body" });
  const b64 = data.split(",").pop();
  const buf = Buffer.from(b64, "base64");
  const fs = await import("node:fs/promises");
  const file = `/tmp/${(name || "snap") + "-" + Date.now()}.png`;
  await fs.writeFile(file, buf);
  res.json({ ok: true, file });
});

app.get("/api/regions", (_req, res) => {
  res.json({
    defaultRegion: DEFAULT_REGION,
    regions: REGIONS
      .filter((r) => sources.has(r.id))
      .map((r) => ({
        id: r.id,
        label: r.label,
        operator: r.operator,
        origin: r.origin,
      })),
  });
});

app.get("/api/network", (req, res) => {
  const regionId = String(req.query.region || DEFAULT_REGION);
  const network = networks.get(regionId);
  if (!network) return res.status(404).json({ error: "unknown region" });
  res.json(network);
});

// Extra user-facing stops for a region (bus stops etc. that live outside the
// drawn rail/ferry network but are still useful for search).
app.get("/api/stops", (req, res) => {
  const regionId = String(req.query.region || DEFAULT_REGION);
  if (!REGIONS.some((r) => r.id === regionId)) {
    return res.status(404).json({ error: "unknown region" });
  }
  const stopsPath = resolve(__dirname, `../data/regions/${regionId}/stops.json`);
  try {
    const stops = JSON.parse(readFileSync(stopsPath, "utf8"));
    res.json(stops);
  } catch {
    // Missing file just means the extractor hasn't been run — return empty.
    res.json([]);
  }
});

// Proxy to Trafiklab Realtime "Timetables" API. Our scene tracks rail/metro
// positions live, but for authoritative upcoming departures (including SJ,
// Flixtrain, commercial operators and platform info) we hit this API on
// station click. Results are cached per stop for 15 s to avoid hammering
// upstream when users click around.
const TRAFIKLAB_RT_KEY = process.env.TRAFIKLAB_REALTIME_KEY ?? null;
const departuresCache = new Map(); // stopId -> { at, payload }
app.get("/api/departures", async (req, res) => {
  if (!TRAFIKLAB_RT_KEY) {
    return res.status(503).json({ error: "TRAFIKLAB_REALTIME_KEY not configured" });
  }
  const raw = String(req.query.stopId || "").trim();
  if (!/^[0-9]{1,9}$/.test(raw)) {
    return res.status(400).json({ error: "stopId must be numeric" });
  }
  // Trafiklab wants a 9-digit rikshållplats id. Our dataset stores the short
  // numeric id; prepend the 740 country prefix and zero-pad.
  const riks = raw.length === 9 ? raw : `740${raw.padStart(6, "0")}`;
  const cached = departuresCache.get(riks);
  if (cached && Date.now() - cached.at < 15_000) {
    return res.json(cached.payload);
  }
  try {
    const duration = Math.min(120, Math.max(10, Number(req.query.duration) || 60));
    const url = `https://realtime-api.trafiklab.se/v1/departures/${riks}?duration=${duration}&key=${TRAFIKLAB_RT_KEY}`;
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `upstream ${upstream.status}` });
    }
    const json = await upstream.json();
    const payload = {
      stopId: raw,
      riks,
      stop: json.stops?.[0] ?? null,
      departures: (json.departures ?? []).map((d) => {
        // Trafiklab may return a plain string for some fields and a
        // `{id, designation}` / `{id, name}` object for others. Normalise
        // every field we expose to a primitive so the React side never
        // tries to render a bare object.
        const scalar = (v, keys = ["designation", "name", "text"]) => {
          if (v == null) return null;
          if (typeof v === "string" || typeof v === "number") return v;
          if (typeof v === "object") {
            for (const k of keys) if (typeof v[k] === "string") return v[k];
          }
          return null;
        };
        return {
          scheduled: scalar(d.scheduled),
          realtime: scalar(d.realtime),
          delay: Number(d.delay ?? 0),
          canceled: !!d.canceled,
          isRealtime: !!d.is_realtime,
          line: scalar(d.route?.designation) ?? "",
          lineName: scalar(d.route?.name),
          direction: scalar(d.route?.direction) ?? "",
          mode: scalar(d.route?.transport_mode),
          origin: scalar(d.route?.origin),
          destination: scalar(d.route?.destination),
          scheduledPlatform: scalar(d.scheduled_platform),
          realtimePlatform: scalar(d.realtime_platform),
          agency: scalar(d.agency),
          tripId: scalar(d.trip?.trip_id),
          alerts: Array.isArray(d.alerts) ? d.alerts.length : 0,
        };
      }),
    };
    departuresCache.set(riks, { at: Date.now(), payload });
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/status", (_req, res) => {
  const perRegion = {};
  for (const [id, source] of sources) {
    const snap = source.snapshot();
    perRegion[id] = { trains: snap.trains.length, alerts: snap.alerts.length };
  }
  res.json({
    status: "ok",
    source: usingLive ? "trafiklab-gtfs-rt" : "simulator",
    regions: perRegion,
    uptime: Date.now() - startTime,
  });
});

app.get("/api/trends", (req, res) => {
  const regionId = String(req.query.region || DEFAULT_REGION);
  const rec = trendRecorders.get(regionId);
  if (!rec) return res.status(404).json({ error: "unknown region" });
  res.json(rec.snapshot());
});

// History window for replay. /api/history/range gives the bounds + sample
// interval so the client can draw the scrubber, and /api/history/at returns
// the buffered snapshot nearest the requested timestamp.
app.get("/api/history/range", (req, res) => {
  const regionId = String(req.query.region || DEFAULT_REGION);
  const rec = historyRecorders.get(regionId);
  if (!rec) return res.status(404).json({ error: "unknown region" });
  res.json(rec.range());
});
app.get("/api/chronic", (req, res) => {
  const regionId = String(req.query.region || DEFAULT_REGION);
  const tracker = chronicTrackers.get(regionId);
  if (!tracker) return res.status(404).json({ error: "unknown region" });
  res.json(tracker.getScores());
});
app.get("/api/history/at", (req, res) => {
  const regionId = String(req.query.region || DEFAULT_REGION);
  const rec = historyRecorders.get(regionId);
  if (!rec) return res.status(404).json({ error: "unknown region" });
  const t = Number(req.query.t);
  if (!Number.isFinite(t)) return res.status(400).json({ error: "t must be a numeric timestamp" });
  const snap = rec.snapshotAt(t);
  if (!snap) return res.status(204).end();
  res.json(snap);
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/stream" });

wss.on("connection", (ws) => {
  let currentRegion = null;
  let unsubscribe = null;
  let unsubscribeAI = null;

  function subscribe(regionId) {
    if (!sources.has(regionId)) return;
    // Tear down previous region's subscriptions, including the AI analyst
    // reservation so idle regions can pause.
    if (unsubscribe) unsubscribe();
    if (unsubscribeAI) unsubscribeAI();
    if (currentRegion && aiAnalysts.has(currentRegion)) aiAnalysts.get(currentRegion).release();

    currentRegion = regionId;
    const source = sources.get(regionId);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "region", region: regionId }));
      ws.send(JSON.stringify({ type: "snapshot", region: regionId, data: source.snapshot() }));
    }
    unsubscribe = source.on((snap) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "snapshot", region: regionId, data: snap }));
      }
    });
    // Kick off an immediate refresh so the subscriber doesn't see a stale or
    // empty snapshot while waiting up to 30s for the next scheduled poll.
    source.ensureFresh?.();

    const analyst = aiAnalysts.get(regionId);
    if (analyst) {
      analyst.acquire();
      // Immediately push the latest cached analysis (may be from a previous
      // viewer) so the panel isn't empty while the next tick is running.
      if (analyst.latest) {
        ws.send(JSON.stringify({ type: "ai", data: { latest: analyst.latest, error: analyst.lastError, regionId } }));
      } else if (!analyst.apiKey) {
        ws.send(JSON.stringify({ type: "ai", data: { latest: null, error: null, regionId } }));
      }
      unsubscribeAI = analyst.on((payload) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "ai", data: payload }));
        }
      });
    }
  }

  ws.send(JSON.stringify({
    type: "hello",
    source: usingLive ? "trafiklab" : "simulator",
    aiEnabled,
    regions: REGIONS.filter((r) => sources.has(r.id)).map((r) => ({ id: r.id, label: r.label })),
    defaultRegion: DEFAULT_REGION,
  }));
  subscribe(DEFAULT_REGION);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "set-region" && typeof msg.region === "string" && sources.has(msg.region)) {
        subscribe(msg.region);
      }
    } catch {}
  });

  ws.on("close", () => {
    if (unsubscribe) unsubscribe();
    if (unsubscribeAI) unsubscribeAI();
    if (currentRegion && aiAnalysts.has(currentRegion)) aiAnalysts.get(currentRegion).release();
  });
});

server.listen(PORT, () => {
  console.log(`[stockholms-puls] server on http://localhost:${PORT}`);
  console.log(`[stockholms-puls] data source: ${usingLive ? "Trafiklab GTFS-RT" : "simulator (set TRAFIKLAB_KEY for live data)"}`);
  console.log(`[stockholms-puls] regions: ${[...sources.keys()].join(", ")}`);
});

process.on("SIGINT", () => {
  for (const src of sources.values()) src.stop();
  for (const a of aiAnalysts.values()) a.stop();
  for (const rec of trendRecorders.values()) rec.stop();
  for (const rec of historyRecorders.values()) rec.stop();
  for (const t of chronicTrackers.values()) t.stop();
  server.close(() => process.exit(0));
});
