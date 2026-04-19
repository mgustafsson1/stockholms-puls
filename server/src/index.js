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

const __dirname = dirname(fileURLToPath(import.meta.url));
const NETWORK_PATH = resolve(__dirname, "../data/network.json");
const network = JSON.parse(readFileSync(NETWORK_PATH, "utf8"));

const PORT = Number(process.env.PORT ?? 4000);
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

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

app.get("/api/network", (_req, res) => {
  res.json(network);
});

app.get("/api/status", (_req, res) => {
  const snap = source.snapshot();
  res.json({
    status: "ok",
    source: hasTrafiklabKey() ? "trafiklab-gtfs-rt" : "simulator",
    trains: snap.trains.length,
    alerts: snap.alerts.length,
    uptime: Date.now() - startTime,
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/stream" });

const startTime = Date.now();
const source = hasTrafiklabKey()
  ? new LiveSource(network)
  : new Simulator(network);

const aiAnalyst = new AIAnalyst({
  getSnapshot: () => source.snapshot(),
  network,
  intervalMs: Number(process.env.AI_INTERVAL_MS ?? 90_000),
});

const trendRecorder = new TrendRecorder({
  getSnapshot: () => source.snapshot(),
  intervalMs: Number(process.env.TREND_INTERVAL_MS ?? 30_000),
  maxSamples: 120,
});

app.get("/api/trends", (_req, res) => {
  res.json(trendRecorder.snapshot());
});

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "hello", source: hasTrafiklabKey() ? "trafiklab" : "simulator", aiEnabled: !!aiAnalyst.apiKey }));
  ws.send(JSON.stringify({ type: "snapshot", data: source.snapshot() }));
  if (aiAnalyst.latest) {
    ws.send(JSON.stringify({ type: "ai", data: { latest: aiAnalyst.latest, error: aiAnalyst.lastError } }));
  }

  const unsubscribe = source.on((snap) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "snapshot", data: snap }));
    }
  });
  const unsubscribeAI = aiAnalyst.on((payload) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "ai", data: payload }));
    }
  });

  ws.on("close", () => {
    unsubscribe();
    unsubscribeAI();
  });
});

server.listen(PORT, () => {
  console.log(`[stockholms-puls] server on http://localhost:${PORT}`);
  console.log(`[stockholms-puls] data source: ${hasTrafiklabKey() ? "Trafiklab GTFS-RT" : "simulator (set TRAFIKLAB_KEY for live data)"}`);
});

process.on("SIGINT", () => {
  source.stop();
  aiAnalyst.stop();
  trendRecorder.stop();
  server.close(() => process.exit(0));
});
