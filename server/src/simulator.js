import { haversine } from "./geo.js";

const TRAIN_SPEED_MPS = 14; // ~50 km/h average including stops
const DWELL_SECONDS = 25; // time at each station
const TICK_MS = 1000;

const STATUS = { OK: "ok", DELAYED: "delayed", STOPPED: "stopped" };

export class Simulator {
  constructor(network) {
    this.network = network;
    this.stationById = new Map(network.stations.map((s) => [s.id, s]));
    this.trains = [];
    this.alerts = [];
    this.startTime = Date.now();
    this.nextTrainId = 1;
    this.listeners = new Set();

    this.spawnAll();
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
    this.alertHandle = setInterval(() => this.maybeAlert(), 45_000);
    this.delayHandle = setInterval(() => this.maybeDelay(), 22_000);
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  spawnAll() {
    for (const line of this.network.lines) {
      const segments = this.segmentDurations(line);
      const totalSegments = segments.length;
      const trainsPerDirection = Math.max(3, Math.min(6, Math.round(totalSegments / 4)));
      for (const dir of [1, -1]) {
        for (let i = 0; i < trainsPerDirection; i++) {
          const phase = i / trainsPerDirection;
          const segIdx = Math.floor(phase * totalSegments);
          const segProgress = (phase * totalSegments) % 1;
          this.trains.push({
            id: `${line.id}-${dir > 0 ? "N" : "S"}-${this.nextTrainId++}`,
            lineId: line.id,
            lineColor: line.color,
            lineGroup: line.line,
            direction: dir,
            segmentIdx: dir === 1 ? segIdx : totalSegments - 1 - segIdx,
            segmentProgress: segProgress,
            dwellRemaining: 0,
            delaySeconds: 0,
            status: STATUS.OK,
          });
        }
      }
    }
  }

  segmentDurations(line) {
    const out = [];
    for (let i = 0; i < line.stations.length - 1; i++) {
      const a = this.stationById.get(line.stations[i]);
      const b = this.stationById.get(line.stations[i + 1]);
      if (!a || !b) {
        out.push(60);
        continue;
      }
      const dist = haversine(a, b);
      out.push(Math.max(30, dist / TRAIN_SPEED_MPS));
    }
    return out;
  }

  tick() {
    const now = Date.now();
    for (const train of this.trains) {
      const line = this.network.lines.find((l) => l.id === train.lineId);
      if (!line) continue;
      const durations = this.segmentDurations(line);
      const maxIdx = line.stations.length - 2;

      if (train.dwellRemaining > 0) {
        train.dwellRemaining -= TICK_MS / 1000;
        if (train.dwellRemaining < 0) train.dwellRemaining = 0;
        continue;
      }

      const segDur = durations[train.segmentIdx] ?? 60;
      const speedMul = train.status === STATUS.STOPPED ? 0 : train.status === STATUS.DELAYED ? 0.4 : 1;
      train.segmentProgress += (TICK_MS / 1000) / segDur * speedMul;

      if (train.segmentProgress >= 1) {
        train.segmentProgress = 0;
        train.dwellRemaining = DWELL_SECONDS + (train.delaySeconds > 0 ? Math.min(train.delaySeconds, 20) : 0);
        train.delaySeconds = Math.max(0, train.delaySeconds - 20);

        const next = train.segmentIdx + train.direction;
        if (next < 0 || next > maxIdx) {
          train.direction *= -1;
          train.segmentIdx = train.direction === 1 ? 0 : maxIdx;
        } else {
          train.segmentIdx = next;
        }

        if (train.status === STATUS.STOPPED && Math.random() < 0.3) {
          train.status = STATUS.DELAYED;
        } else if (train.status === STATUS.DELAYED && train.delaySeconds === 0 && Math.random() < 0.4) {
          train.status = STATUS.OK;
        }
      }
    }

    this.alerts = this.alerts.filter((a) => now - a.createdAt < a.durationMs);
    this.emit();
  }

  maybeDelay() {
    if (Math.random() > 0.55) return;
    const candidates = this.trains.filter((t) => t.status === STATUS.OK);
    if (!candidates.length) return;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    target.status = Math.random() < 0.15 ? STATUS.STOPPED : STATUS.DELAYED;
    target.delaySeconds = 30 + Math.floor(Math.random() * 180);
  }

  maybeAlert() {
    if (Math.random() > 0.35) return;
    const stations = this.network.stations;
    const s = stations[Math.floor(Math.random() * stations.length)];
    this.alerts.push({
      id: `alert-${Date.now()}`,
      stationId: s.id,
      stationName: s.name,
      message: pickAlertMessage(),
      createdAt: Date.now(),
      durationMs: 90_000 + Math.floor(Math.random() * 90_000),
    });
  }

  snapshot() {
    const stationById = this.stationById;
    const network = this.network;
    const trainPayload = this.trains.map((t) => {
      const line = network.lines.find((l) => l.id === t.lineId);
      const fromId = line.stations[t.segmentIdx];
      const toId = line.stations[t.segmentIdx + t.direction];
      const from = stationById.get(fromId);
      const to = stationById.get(toId) ?? from;
      const p = t.dwellRemaining > 0 ? 0 : t.segmentProgress;
      return {
        id: t.id,
        lineId: t.lineId,
        lineGroup: t.lineGroup,
        color: t.lineColor,
        status: t.status,
        delay: t.delaySeconds,
        direction: t.direction,
        from: fromId,
        to: toId ?? fromId,
        progress: p,
        atStation: t.dwellRemaining > 0,
        lat: from.lat + (to.lat - from.lat) * p,
        lon: from.lon + (to.lon - from.lon) * p,
        depth: (from.depth ?? 0) + ((to.depth ?? 0) - (from.depth ?? 0)) * p,
      };
    });

    return {
      t: Date.now(),
      trains: trainPayload,
      alerts: this.alerts,
    };
  }

  emit() {
    const snap = this.snapshot();
    for (const fn of this.listeners) {
      try { fn(snap); } catch { /* swallow */ }
    }
  }

  stop() {
    clearInterval(this.tickHandle);
    clearInterval(this.alertHandle);
    clearInterval(this.delayHandle);
  }
}

const ALERT_MESSAGES = [
  "Signalfel",
  "Sjukdomsfall ombord",
  "Polisingripande",
  "Obehörig person i spår",
  "Tekniskt fel på tåget",
  "Förseningar i trafiken",
  "Växelfel",
  "Förkortad trafikering",
];

function pickAlertMessage() {
  return ALERT_MESSAGES[Math.floor(Math.random() * ALERT_MESSAGES.length)];
}
