// Per-region "chronic delay" tracker. For each station in the network, we
// accumulate a score that grows when trains approaching or standing at the
// station report delays or stops, and decays exponentially over time so
// old events fade. The result is a heatmap-style signal — high score =
// recently-and-often unreliable, low score = consistently on time.
//
// Persisted to disk every `saveIntervalMs` so the signal doesn't evaporate
// on every server reload.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Half-life in milliseconds: after this duration, a score has halved. 24 h
// means yesterday's disruption still shows up at 50 % strength today and
// falls to 25 % by tomorrow — good compromise between "now" and "lately".
const DEFAULT_HALF_LIFE_MS = 24 * 60 * 60 * 1000;

function decayFactor(dtMs, halfLifeMs) {
  if (dtMs <= 0) return 1;
  return Math.pow(0.5, dtMs / halfLifeMs);
}

export class ChronicDelayTracker {
  constructor({ regionId, persistPath = null, halfLifeMs = DEFAULT_HALF_LIFE_MS, saveIntervalMs = 10 * 60 * 1000 }) {
    this.regionId = regionId;
    this.halfLifeMs = halfLifeMs;
    this.persistPath = persistPath;
    this.scores = new Map(); // stationId -> { score, lastUpdate }

    if (persistPath && existsSync(persistPath)) {
      try {
        const data = JSON.parse(readFileSync(persistPath, "utf8"));
        if (data && typeof data === "object") {
          for (const [id, s] of Object.entries(data.scores ?? {})) {
            if (typeof s?.score === "number" && typeof s?.lastUpdate === "number") {
              this.scores.set(id, { score: s.score, lastUpdate: s.lastUpdate });
            }
          }
          console.log(`[chronic:${regionId}] loaded ${this.scores.size} station scores`);
        }
      } catch (err) {
        console.warn(`[chronic:${regionId}] failed to load persisted scores:`, err.message);
      }
    }

    if (persistPath && saveIntervalMs > 0) {
      this.saveHandle = setInterval(() => this.save(), saveIntervalMs);
    }
  }

  stop() {
    if (this.saveHandle) clearInterval(this.saveHandle);
    this.save();
  }

  // Fold a fresh snapshot into the tracker. Called once per live-source
  // emission; cheap enough to run on every tick (O(trains)).
  observe(snapshot) {
    if (!snapshot?.trains) return;
    const now = Date.now();
    for (const t of snapshot.trains) {
      const contribution = contributionFor(t);
      if (contribution <= 0) continue;
      // Attribute to the station the train is at, or the one it's heading
      // to if mid-segment. Skip trains without geometry (bus fallbacks).
      const stationId = t.atStation ? (t.from || t.to) : (t.to || t.from);
      if (!stationId) continue;
      this.bump(stationId, contribution, now);
    }
  }

  bump(stationId, amount, now) {
    const prev = this.scores.get(stationId);
    if (prev) {
      const decayed = prev.score * decayFactor(now - prev.lastUpdate, this.halfLifeMs);
      this.scores.set(stationId, { score: decayed + amount, lastUpdate: now });
    } else {
      this.scores.set(stationId, { score: amount, lastUpdate: now });
    }
  }

  // Emit a plain {stationId: score} map with all scores projected forward
  // to `now` so the client sees a coherent snapshot (no entries frozen at
  // different timestamps).
  getScores() {
    const now = Date.now();
    const out = {};
    let max = 0;
    for (const [id, s] of this.scores) {
      const decayed = s.score * decayFactor(now - s.lastUpdate, this.halfLifeMs);
      if (decayed < 0.05) continue; // prune insignificant signal from the payload
      out[id] = decayed;
      if (decayed > max) max = decayed;
    }
    return { scores: out, max, halfLifeMs: this.halfLifeMs };
  }

  save() {
    if (!this.persistPath) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const payload = { scores: Object.fromEntries(this.scores), savedAt: Date.now() };
      writeFileSync(this.persistPath, JSON.stringify(payload));
    } catch (err) {
      console.warn(`[chronic:${this.regionId}] save failed:`, err.message);
    }
  }
}

function contributionFor(t) {
  if (t.status === "stopped") return 2.0;
  if (t.status === "delayed") {
    if (t.delay >= 300) return 1.0;
    if (t.delay >= 60) return 0.4;
  }
  return 0;
}
