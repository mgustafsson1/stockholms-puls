import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { Simulator } from "./simulator.js";
import { LiveSource, hasTrafiklabKey } from "./liveSource.js";
import { AIAnalyst } from "./aiAnalyst.js";
import { TrendRecorder } from "./trendRecorder.js";
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
for (const [id, source] of sources) {
  trendRecorders.set(id, new TrendRecorder({
    regionId: id,
    network: networks.get(id),
    getSnapshot: () => source.snapshot(),
    intervalMs: Number(process.env.TREND_INTERVAL_MS ?? 30_000),
    maxSamples: 120,
  }));
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
  server.close(() => process.exit(0));
});
