// Per-region rolling buffer of compact snapshots used by the replay UI.
// Keeps just enough per-vehicle data to re-render the scene and open an
// info panel — click-card extras (bus operator, speed, bearing, occupancy)
// are dropped so the buffer stays small enough to live in memory.

function compactTrain(t) {
  return {
    id: t.id,
    lineId: t.lineId,
    lineGroup: t.lineGroup,
    mode: t.mode,
    color: t.color,
    status: t.status,
    delay: t.delay,
    direction: t.direction,
    from: t.from,
    to: t.to,
    progress: t.progress,
    atStation: t.atStation,
    lat: t.lat,
    lon: t.lon,
    depth: t.depth,
  };
}

export class HistoryRecorder {
  constructor({ regionId, getSnapshot, intervalMs = 60_000, maxSamples = 180 }) {
    this.regionId = regionId;
    this.getSnapshot = getSnapshot;
    this.intervalMs = intervalMs;
    this.maxSamples = maxSamples;
    this.samples = []; // [{ t, trains, alerts }]
    this.tick = this.tick.bind(this);
    this.handle = setInterval(this.tick, intervalMs);
    // First tick after a short grace period so the live source has data.
    setTimeout(this.tick, 5_000);
  }

  stop() {
    clearInterval(this.handle);
  }

  tick() {
    try {
      const snap = this.getSnapshot();
      if (!snap) return;
      this.samples.push({
        t: snap.t || Date.now(),
        trains: (snap.trains ?? []).map(compactTrain),
        alerts: snap.alerts ?? [],
      });
      while (this.samples.length > this.maxSamples) this.samples.shift();
    } catch (err) {
      console.warn(`[history:${this.regionId}] tick failed:`, err.message);
    }
  }

  range() {
    if (!this.samples.length) return { from: 0, to: 0, count: 0, intervalMs: this.intervalMs };
    return {
      from: this.samples[0].t,
      to: this.samples[this.samples.length - 1].t,
      count: this.samples.length,
      intervalMs: this.intervalMs,
    };
  }

  // Closest sample at-or-before the requested timestamp. When the timestamp
  // sits in the future relative to our buffer we return the latest sample,
  // so the client can pin to "now" without special-casing.
  snapshotAt(t) {
    if (!this.samples.length) return null;
    if (t >= this.samples[this.samples.length - 1].t) return this.samples[this.samples.length - 1];
    if (t <= this.samples[0].t) return this.samples[0];
    // Linear scan is fine at N≤180; binary search if this ever grows.
    for (let i = this.samples.length - 1; i >= 0; i--) {
      if (this.samples[i].t <= t) return this.samples[i];
    }
    return this.samples[0];
  }
}
