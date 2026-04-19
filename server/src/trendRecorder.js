// Stockholm-specific line-group overrides: merge sibling lines (e.g. T13+T14 →
// "red"). Non-Stockholm regions just get grouped by lineId, so every region
// gets a meaningful palette without per-region hand-maintenance.
const STOCKHOLM_LINE_GROUP = {
  T13: "red", T14: "red",
  T17: "green", T18: "green", T19: "green",
  T10: "blue", T11: "blue",
  J40: "rail", J41: "rail", J43: "rail", J43X: "rail", J48: "rail",
  L25: "saltsjobanan", L26: "saltsjobanan",
  L27: "roslagsbanan", L27S: "roslagsbanan", L28: "roslagsbanan", L28S: "roslagsbanan", L28X: "roslagsbanan", L29: "roslagsbanan",
  L30: "tvarbana", L31: "tvarbana",
  S7: "tram", S12: "tram", S21: "tram",
  B80: "ferry", B80X: "ferry", B84: "ferry", B89: "ferry",
};

const STOCKHOLM_GROUP_META = {
  red:          { label: "Röd (T13/T14)",    color: "#ff3d4a", mode: "subway" },
  green:        { label: "Grön (T17-T19)",   color: "#4bd582", mode: "subway" },
  blue:         { label: "Blå (T10/T11)",    color: "#39a7ff", mode: "subway" },
  rail:         { label: "Pendeltåg",        color: "#ff7a1f", mode: "rail" },
  tvarbana:     { label: "Tvärbanan",        color: "#b084ff", mode: "lightrail" },
  roslagsbanan: { label: "Roslagsbanan",     color: "#c266d9", mode: "lightrail" },
  saltsjobanan: { label: "Saltsjöbanan",     color: "#ff6fb5", mode: "lightrail" },
  tram:         { label: "Spårvagn",         color: "#f4c430", mode: "tram" },
  ferry:        { label: "Pendelbåt",        color: "#24d4d4", mode: "ferry" },
  bus:          { label: "Buss",             color: "#7f88a0", mode: "bus" },
};

function buildGroupConfig(regionId, network) {
  // Returns { groupOf(train) -> groupId, groups: [{id,label,color,mode}] }
  if (regionId === "stockholm") {
    const groups = Object.entries(STOCKHOLM_GROUP_META).map(([id, m]) => ({ id, ...m }));
    return {
      groups,
      groupOf: (train) => {
        if (train.mode === "bus") return "bus";
        return STOCKHOLM_LINE_GROUP[train.lineId] || train.lineId;
      },
    };
  }

  // Generic region: one group per line, plus a single "bus" group. Labels and
  // colours come from the network definition.
  const lineLookup = new Map(network.lines.map((l) => [l.id, l]));
  const groups = network.lines.map((l) => ({
    id: l.id,
    label: `${l.id}${l.name && l.name !== l.line ? ` · ${l.name}` : ""}`,
    color: l.color,
    mode: l.mode ?? "rail",
  }));
  groups.push({ id: "bus", label: "Buss", color: "#7f88a0", mode: "bus" });
  return {
    groups,
    groupOf: (train) => {
      if (train.mode === "bus") return "bus";
      return lineLookup.has(train.lineId) ? train.lineId : "bus";
    },
  };
}

export class TrendRecorder {
  constructor({ regionId, network, getSnapshot, intervalMs = 30_000, maxSamples = 120 }) {
    this.regionId = regionId;
    this.network = network;
    this.getSnapshot = getSnapshot;
    this.intervalMs = intervalMs;
    this.maxSamples = maxSamples;
    this.samples = [];
    this.config = buildGroupConfig(regionId, network);
    this.tick = this.tick.bind(this);
    this.handle = setInterval(this.tick, intervalMs);
    setTimeout(this.tick, 1500); // record soon after startup
  }

  stop() {
    clearInterval(this.handle);
  }

  tick() {
    try {
      const snap = this.getSnapshot();
      const byGroup = {};
      for (const t of snap.trains) {
        const key = this.config.groupOf(t);
        let g = byGroup[key];
        if (!g) {
          g = { delaySum: 0, delayCount: 0, ok: 0, delayed: 0, stopped: 0, total: 0 };
          byGroup[key] = g;
        }
        g.total++;
        if (t.status === "ok") g.ok++;
        else if (t.status === "delayed") g.delayed++;
        else if (t.status === "stopped") g.stopped++;
        if (t.delay && t.delay > 0) {
          g.delaySum += t.delay;
          g.delayCount++;
        }
      }
      const byGroupOut = {};
      for (const [key, g] of Object.entries(byGroup)) {
        byGroupOut[key] = {
          total: g.total,
          ok: g.ok,
          delayed: g.delayed,
          stopped: g.stopped,
          avgDelay: g.delayCount ? Math.round(g.delaySum / g.delayCount) : 0,
          punctuality: g.total ? g.ok / g.total : 0,
        };
      }
      this.samples.push({ t: snap.t || Date.now(), byGroup: byGroupOut });
      while (this.samples.length > this.maxSamples) this.samples.shift();
    } catch (err) {
      console.warn("[trends] tick failed:", err.message);
    }
  }

  snapshot() {
    return {
      intervalMs: this.intervalMs,
      maxSamples: this.maxSamples,
      groups: this.config.groups,
      samples: this.samples.slice(),
    };
  }
}
