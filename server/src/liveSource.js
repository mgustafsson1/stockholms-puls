import { haversine } from "./geo.js";
import gtfsBindings from "gtfs-realtime-bindings";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const { transit_realtime } = gtfsBindings;

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTripMap(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

// 45 s keeps us comfortably under the Trafiklab 60-requests/min quota even
// with 13 regions and Sydsverige pooling 5 operator feeds. If you add more
// regions, do the quota arithmetic before bumping this back down.
const POLL_MS = 45_000;
const STATION_MATCH_METERS = 120;
const STALE_TRAIN_MS = 120_000;

// Shared across every LiveSource: deduplicates concurrent fetches of the same
// upstream URL (Sydsverige pools 5 operator feeds that the individual-RTO
// regions already ask for) and serves any request made within `CACHE_TTL_MS`
// of a successful fetch straight from memory. This means the Trafiklab API
// sees exactly one hit per distinct operator+kind per ~30 s no matter how
// many regions or subscribers we have.
const FEED_CACHE_TTL_MS = 30_000;
const feedCache = new Map(); // url (sans key) → { at, buf }
const feedInflight = new Map(); // url (sans key) → Promise<Buffer>

async function fetchFeed(url) {
  // Strip the `?key=…` suffix when forming the cache key — it's the same
  // payload regardless of which key asked for it, but we don't want the raw
  // key leaking into any debug dump.
  const cacheKey = url.split("?")[0];
  const cached = feedCache.get(cacheKey);
  if (cached && Date.now() - cached.at < FEED_CACHE_TTL_MS) {
    return cached.buf;
  }
  const existing = feedInflight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(url, { headers: { "Accept-Encoding": "gzip, deflate" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} at ${cacheKey}`);
    const buf = Buffer.from(await res.arrayBuffer());
    feedCache.set(cacheKey, { at: Date.now(), buf });
    return buf;
  })()
    .finally(() => feedInflight.delete(cacheKey));
  feedInflight.set(cacheKey, promise);
  return promise;
}

export function hasTrafiklabKey() {
  return !!(process.env.TRAFIKLAB_KEY || process.env.TRAFIKLAB_API_KEY);
}

function getKey() {
  return process.env.TRAFIKLAB_KEY || process.env.TRAFIKLAB_API_KEY;
}

export class LiveSource {
  constructor(network, options = {}) {
    this.network = network;
    this.regionId = options.regionId ?? "default";
    this.label = options.label ?? this.regionId;
    // Multi-operator views (e.g. "sydsverige" spanning skane+halland+blekinge+
    // krono+klt) pool N operator feeds into one source. A single-operator
    // region stays backwards compatible via `options.operator`.
    const opsList = Array.isArray(options.operators) && options.operators.length
      ? options.operators
      : [options.operator ?? "sl"];
    this.operators = opsList;
    this.operator = opsList[0];
    const urlFor = (op, kind) => `https://opendata.samtrafiken.se/gtfs-rt-sweden/${op}/${kind}.pb`;
    this.vehicleUrls = options.vehicleUrls ?? opsList.map((o) => urlFor(o, "VehiclePositionsSweden"));
    this.tripUpdatesUrls = options.tripUpdatesUrls ?? opsList.map((o) => urlFor(o, "TripUpdatesSweden"));
    this.alertsUrls = options.alertsUrls ?? opsList.map((o) => urlFor(o, "ServiceAlertsSweden"));
    // Keep the old *Url singletons for anything that still reads them.
    this.vehicleUrl = this.vehicleUrls[0];
    this.tripUpdatesUrl = this.tripUpdatesUrls[0];
    this.alertsUrl = this.alertsUrls[0];
    // Bbox filter for composite regions — we only want vehicles inside the
    // view's geographic window, even though upstream feeds publish the whole
    // RTO's area.
    this.bbox = options.bbox ?? null;
    this.maxMatchMeters = options.maxMatchMeters ?? 400;
    this.maxMatchMetersForced = options.maxMatchMetersForced ?? 600;
    this.ferryMaxMeters = options.ferryMaxMeters ?? 2500;
    // Regions without any drawn lines (rail/tram/ferry) are rendered as bare
    // bus dots on the OSM basemap — delay data from TripUpdates has no
    // geometry to attach to, so we skip that endpoint to save API quota.
    const hasDrawnLines = (network.lines ?? []).some((l) => (l.mode ?? "subway") !== "bus");
    this.skipTripUpdates = options.skipTripUpdates ?? !hasDrawnLines;
    this.tripMap = options.tripMap ?? (options.tripMapPath ? loadTripMap(options.tripMapPath) : {});
    const byMode = {};
    for (const info of Object.values(this.tripMap)) {
      byMode[info.mode] = (byMode[info.mode] ?? 0) + 1;
    }
    const summary = Object.entries(byMode).map(([m, n]) => `${m}:${n}`).join(" ");
    console.log(`[live:${this.regionId}] ${Object.keys(this.tripMap).length} trip→line mappings (${summary || "none"})`);

    this.stationById = new Map(network.stations.map((s) => [s.id, s]));
    this.segments = buildSegments(network);
    this.trains = new Map();
    this.alerts = [];
    this.tripDelays = new Map();
    this.listeners = new Set();
    this.startTime = Date.now();
    this.lastError = null;
    this.lastFetchAt = 0;
    // Viewer reference count — polls only run while someone is actually
    // watching the region. 15 regions × constant polling pegs a 1-CPU box
    // at 100% even though nobody's looking at Västmanland.
    this.refCount = 0;

    // Stagger start times so regions don't all fire at the same second.
    const jitter = Math.floor(Math.random() * POLL_MS);
    const tripOp = this.skipTripUpdates ? "skipped" : "every tick";
    console.log(`[live:${this.regionId}] vehicle-poll=${POLL_MS}ms, trip-updates=${tripOp}`);
    setTimeout(() => {
      this.pollVehicles().catch(() => {});
      if (!this.skipTripUpdates) this.pollTripUpdates().catch(() => {});
      // Fire alerts immediately too — users shouldn't have to wait up to
      // POLL_MS*4 for the first disruption list to populate.
      this.pollAlerts().catch(() => {});
      this.vehicleHandle = setInterval(() => this.pollVehicles().catch(() => {}), POLL_MS);
      if (!this.skipTripUpdates) {
        this.tripsHandle = setInterval(() => this.pollTripUpdates().catch(() => {}), POLL_MS);
      }
      this.alertsHandle = setInterval(() => this.pollAlerts().catch(() => {}), POLL_MS * 4);
    }, jitter);
    // Snapshots run ~300 KB for Stockholm-scale regions. At 1 Hz that was
    // ~300 KB/s of JSON.stringify + ws.send per subscriber, enough to peg
    // a 1-CPU box on its own. Data only really changes on the 45 s poll, so
    // 5 s is plenty for the "live" feel and ~6× cheaper.
    this.broadcastHandle = setInterval(() => this.emit(), 5000);
    this.pruneHandle = setInterval(() => this.prune(), 20_000);
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Called by WS subscribers. Polls only run while refCount > 0; background
  // consumers that want state as it changes (ChronicDelayTracker) use on()
  // without acquiring, so they observe but don't keep the region warm.
  acquire() {
    this.refCount++;
    if (this.refCount === 1) {
      // Kick an immediate poll so the new viewer doesn't wait up to POLL_MS
      // for their first fresh tick.
      this.pollVehicles().catch(() => {});
      if (!this.skipTripUpdates) this.pollTripUpdates().catch(() => {});
      this.pollAlerts().catch(() => {});
      console.log(`[live:${this.regionId}] active (viewers=${this.refCount})`);
    }
  }

  release() {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) {
      console.log(`[live:${this.regionId}] idle — polls paused`);
    }
  }

  stop() {
    clearInterval(this.vehicleHandle);
    clearInterval(this.tripsHandle);
    clearInterval(this.alertsHandle);
    clearInterval(this.broadcastHandle);
    clearInterval(this.pruneHandle);
  }

  // Trigger an immediate poll if the last successful fetch is older than
  // `maxAgeMs`. Used when a fresh WebSocket subscriber attaches so the user
  // doesn't have to wait up to 30s for the next scheduled tick.
  ensureFresh(maxAgeMs = 8_000) {
    if (this.inflightRefresh) return;
    const age = Date.now() - (this.lastFetchAt || 0);
    if (age < maxAgeMs) return;
    this.inflightRefresh = true;
    const tasks = [this.pollVehicles()];
    if (!this.skipTripUpdates) tasks.push(this.pollTripUpdates());
    Promise.allSettled(tasks).finally(() => {
      this.inflightRefresh = false;
      // pollVehicles writes into this.trains but does not emit itself; the
      // 1 Hz broadcast loop normally covers that, but we want subscribers to
      // see fresh data without the 1-sec gap after a region switch.
      this.emit();
    });
  }

  async pollTripUpdates() {
    const key = getKey();
    if (!key) return;
    if (this.refCount === 0) return;
    try {
      const feeds = await Promise.all(this.tripUpdatesUrls.map(async (u) => {
        const buf = await fetchFeed(`${u}?key=${key}`);
        return transit_realtime.FeedMessage.decode(buf);
      }));
      const feed = { entity: feeds.flatMap((f) => f.entity || []) };

      const updates = new Map();
      const nowSec = Date.now() / 1000;
      for (const e of feed.entity) {
        const tu = e.tripUpdate;
        if (!tu?.trip?.tripId) continue;
        const tripId = tu.trip.tripId;
        if (Object.keys(this.tripMap).length && !this.tripMap[tripId]) continue;

        // Skip canceled / duplicated / deleted trips.
        const rel = tu.trip.scheduleRelationship;
        if (rel === 3 || rel === 4 || rel === 5) continue;

        // Pick delay at the NEXT stop (smallest stopSequence among non-skipped).
        const stus = (tu.stopTimeUpdate ?? []).filter(
          (s) => s.scheduleRelationship !== 1,
        );
        if (!stus.length) continue;

        let next = stus[0];
        for (const s of stus) {
          if ((s.stopSequence ?? 0) < (next.stopSequence ?? 0)) next = s;
        }

        // If the next stop's predicted time is well in the past, the trip is done.
        const nextTime = Number(next.arrival?.time ?? next.departure?.time ?? 0);
        if (nextTime && nextTime < nowSec - 120) continue;

        const delay = Number(next.arrival?.delay ?? next.departure?.delay ?? 0);
        const nextStopSeq = next.stopSequence ?? null;
        updates.set(tripId, { delay, nextStopSeq, updatedAt: Date.now() });
      }
      this.tripDelays = updates;
    } catch (err) {
      console.warn("[live] trip updates failed:", err.message);
    }
  }

  async pollVehicles() {
    const key = getKey();
    if (!key) return;
    if (this.refCount === 0) return;
    try {
      const feeds = await Promise.all(this.vehicleUrls.map(async (u) => {
        const buf = await fetchFeed(`${u}?key=${key}`);
        return transit_realtime.FeedMessage.decode(buf);
      }));
      const feed = { entity: feeds.flatMap((f) => f.entity || []) };
      this.lastFetchAt = Date.now();
      this.updateFromFeed(feed);
      this.lastError = null;
      // Push new data straight out rather than waiting up to broadcast
      // interval — with a 5 s broadcast a fresh poll could otherwise sit for
      // almost 5 s before reaching clients.
      this.emit();
    } catch (err) {
      this.lastError = err.message;
      console.warn(`[live:${this.regionId}] vehicle fetch failed:`, err.message);
    }
  }

  async pollAlerts() {
    const key = getKey();
    if (!key) return;
    if (this.refCount === 0) return;
    try {
      const feeds = await Promise.all(this.alertsUrls.map(async (u) => {
        try {
          const buf = await fetchFeed(`${u}?key=${key}`);
          return transit_realtime.FeedMessage.decode(buf);
        } catch {
          return { entity: [] };
        }
      }));
      const feed = { entity: feeds.flatMap((f) => f.entity || []) };
      const now = Date.now();
      const nowSec = now / 1000;
      const out = [];
      for (const e of feed.entity) {
        if (!e.alert) continue;
        const a = e.alert;

        // Respect the alert's activePeriod — SL publishes scheduled works
        // months ahead, we only want what's live right now.
        const periods = a.activePeriod ?? [];
        if (periods.length > 0) {
          const nowActive = periods.some((p) => {
            const start = p.start ? Number(p.start) : 0;
            const end = p.end ? Number(p.end) : Infinity;
            return start <= nowSec && nowSec <= end;
          });
          if (!nowActive) continue;
        }

        const header = (a.headerText?.translation ?? [])[0]?.text ?? "Trafikstörning";
        const desc = (a.descriptionText?.translation ?? [])[0]?.text ?? "";

        // Try to attach to a drawn station (so the scene can halo it) and
        // collect affected route ids so the UI can show line badges. Unlike
        // before we keep the alert even when neither matches — bus-stop
        // alerts carry real operational info that users want to see.
        const affected = a.informedEntity ?? [];
        let stationId = null;
        let stationName = "";
        const routeIds = new Set();
        for (const ie of affected) {
          if (!stationId && ie.stopId) {
            const match = findStationByStopId(this.network, ie.stopId);
            if (match) {
              stationId = match.id;
              stationName = match.name;
            }
          }
          if (ie.routeId) routeIds.add(ie.routeId);
        }

        // Translate route_id (full Samtrafiken prefix) into the short line
        // label we already use for vehicles via tripMap lookup; fall back to
        // the raw routeId if we don't have it.
        const lineIds = Array.from(routeIds).map((rid) => {
          for (const info of Object.values(this.tripMap)) {
            if (info.routeId === rid) return info.lineId;
          }
          return null;
        }).filter(Boolean);

        out.push({
          id: e.id ?? `${this.regionId}-${out.length}`,
          stationId,
          stationName,
          lineIds,
          header,
          message: header || desc.slice(0, 80),
          description: desc,
          severity: normalizeSeverity(a.severityLevel),
          cause: normalizeCause(a.cause),
          effect: normalizeEffect(a.effect),
          activeUntil: periods[0]?.end ? Number(periods[0].end) * 1000 : null,
          createdAt: now,
          durationMs: 5 * 60_000,
        });
      }

      // Dedupe: SL publishes one alert per (route, stop, direction) triple
      // so the same disruption can appear 3-10 times. SL also sometimes
      // ships two copies of the same disruption with a "public" and
      // "operational" header — both share the same description verbatim,
      // so we key by description when it's substantial.
      const deduped = new Map();
      const keyFor = (a) => {
        const desc = (a.description || "").trim();
        if (desc.length >= 30) return `desc:${desc}`;
        return `hd:${(a.header || "").trim()}|${desc}`;
      };
      for (const alert of out) {
        const key = keyFor(alert);
        const existing = deduped.get(key);
        if (!existing) {
          deduped.set(key, {
            ...alert,
            lineIds: [...new Set(alert.lineIds)],
          });
          continue;
        }
        // Union line ids; keep the first station we attached to.
        for (const l of alert.lineIds) {
          if (!existing.lineIds.includes(l)) existing.lineIds.push(l);
        }
        if (!existing.stationId && alert.stationId) {
          existing.stationId = alert.stationId;
          existing.stationName = alert.stationName;
        }
        // Prefer the most informative header — the "public" SL headers are
        // usually in sentence case ("Bussar ersätter…"), the operational
        // ones are terse abbreviations ("Alla LB Käppalaklippet"). Sentence-
        // case versions tend to be longer; use length as a proxy.
        if ((alert.header?.length ?? 0) > (existing.header?.length ?? 0)) {
          existing.header = alert.header;
          existing.message = alert.message;
        }
      }
      for (const a of deduped.values()) {
        if (a.lineIds.length > 4) {
          a.lineIds = a.lineIds.slice(0, 4);
          a.lineIdsMore = true;
        }
      }
      this.alerts = [...deduped.values()];
    } catch (err) {
      console.warn(`[live:${this.regionId}] alerts fetch failed:`, err.message);
    }
  }

  updateFromFeed(feed) {
    const usingTripMap = Object.keys(this.tripMap).length > 0;
    const bb = this.bbox;
    for (const entity of feed.entity) {
      const v = entity.vehicle;
      if (!v?.position) continue;
      const lat = v.position.latitude;
      const lon = v.position.longitude;
      if (!lat || !lon) continue;
      // Composite / multi-operator views usually pull in the whole RTO
      // footprint; clip to this view's bbox so the scene stays focused.
      if (bb && (lat < bb.minLat || lat > bb.maxLat || lon < bb.minLon || lon > bb.maxLon)) continue;

      const tripId = v.trip?.tripId;
      let forcedLineId = null;
      let tripInfo = null;
      if (usingTripMap && tripId) {
        tripInfo = this.tripMap[tripId] ?? null;
        if (tripInfo && tripInfo.mode !== "bus") forcedLineId = tripInfo.lineId;
      }

      const id = v.vehicle?.id || tripId || entity.id;
      if (!id) continue;

      const delayEntry = tripId ? this.tripDelays.get(tripId) : null;
      const delay = delayEntry?.delay ?? 0;

      const extras = {
        routeId: v.trip?.routeId ?? null,
        vehicleLabel: v.vehicle?.label ?? null,
        licensePlate: v.vehicle?.licensePlate ?? null,
        speed: typeof v.position.speed === "number" ? v.position.speed : null,
        bearing: typeof v.position.bearing === "number" ? v.position.bearing : null,
        occupancy: occupancyName(v.occupancyStatus),
        currentStatus: currentStatusName(v.currentStatus),
        feedTimestamp: typeof v.timestamp === "number" ? v.timestamp * 1000
          : v.timestamp?.low != null ? Number(v.timestamp.low) * 1000
          : null,
      };

      // Buses never match our rail segments — render at raw GPS.
      if (tripInfo?.mode === "bus") {
        this.trains.set(id, {
          id,
          lineId: tripInfo.lineId,
          lineGroup: tripInfo.lineId,
          mode: "bus",
          color: tripInfo.color ?? "#7f88a0",
          status: classifyStatus(v, delay),
          delay,
          direction: 1,
          from: null,
          to: null,
          progress: 0,
          atStation: false,
          lat,
          lon,
          depth: 0,
          lastUpdate: Date.now(),
          routeLong: tripInfo.routeLong ?? null,
          headsign: tripInfo.headsign ?? null,
          agency: tripInfo.agency ?? null,
          ...extras,
        });
        continue;
      }

      const match = this.matchToSegment(lat, lon, forcedLineId, tripInfo?.mode);
      if (!match) {
        // No rail/tram/ferry segment match. Keep the vehicle as a bus-style
        // dot so bus-only regions still show activity.
        this.trains.set(id, {
          id,
          lineId: forcedLineId ?? "BUS",
          lineGroup: forcedLineId ?? "BUS",
          mode: "bus",
          color: "#7f88a0",
          status: classifyStatus(v, delay),
          delay,
          direction: 1,
          from: null,
          to: null,
          progress: 0,
          atStation: false,
          lat,
          lon,
          depth: 0,
          lastUpdate: Date.now(),
          ...extras,
        });
        continue;
      }

      this.trains.set(id, {
        id,
        lineId: match.lineId,
        lineGroup: match.lineGroup,
        mode: match.mode,
        color: match.color,
        status: classifyStatus(v, delay),
        delay,
        direction: match.direction,
        from: match.fromId,
        to: match.toId,
        progress: match.progress,
        atStation: match.progress < 0.05,
        lat,
        lon,
        depth: match.depth,
        lastUpdate: Date.now(),
        routeLong: tripInfo?.routeLong ?? null,
        headsign: tripInfo?.headsign ?? null,
        agency: tripInfo?.agency ?? null,
        ...extras,
      });
    }
  }

  matchToSegment(lat, lon, forcedLineId, mode) {
    let best = null;
    const maxMeters = mode === "ferry" ? this.ferryMaxMeters : forcedLineId ? this.maxMatchMetersForced : this.maxMatchMeters;
    for (const seg of this.segments) {
      if (forcedLineId && seg.lineId !== forcedLineId) continue;
      const info = projectOntoSegment(lat, lon, seg);
      if (info.distanceM > maxMeters) continue;
      if (!best || info.distanceM < best.distanceM) {
        best = { ...info, seg };
      }
    }
    if (!best) return null;
    const { seg } = best;
    const a = seg.a;
    const b = seg.b;
    const depth = a.depth + (b.depth - a.depth) * best.progress;
    return {
      lineId: seg.lineId,
      lineGroup: seg.lineGroup,
      mode: seg.mode,
      color: seg.color,
      direction: seg.direction,
      fromId: a.id,
      toId: b.id,
      progress: best.progress,
      depth,
    };
  }

  prune() {
    const cutoff = Date.now() - STALE_TRAIN_MS;
    for (const [id, t] of this.trains) {
      if (t.lastUpdate < cutoff) this.trains.delete(id);
    }
  }

  snapshot() {
    const trains = [];
    for (const t of this.trains.values()) {
      trains.push({
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
      });
    }
    return {
      t: Date.now(),
      trains,
      alerts: this.alerts.slice(),
    };
  }

  emit() {
    // snapshot() allocates a fresh trains[] every call. With a 1-Hz broadcast
    // and ~1700 vehicles in Stockholm that was a lot of garbage per second
    // for a region nobody was watching. Skip when no WS viewers are attached
    // — the chronic-delay tracker observes via on() but doesn't mind missing
    // ticks during idle stretches.
    if (this.refCount === 0) return;
    const snap = this.snapshot();
    for (const fn of this.listeners) {
      try { fn(snap); } catch {}
    }
  }
}

function classifyStatus(v, delaySec = 0) {
  const ts = v.timestamp ? Number(v.timestamp) * 1000 : 0;
  const age = ts ? (Date.now() - ts) / 1000 : 0;
  if (age > 180) return "stopped";
  if (delaySec >= 300) return "stopped";
  if (delaySec >= 60) return "delayed";
  return "ok";
}

// GTFS-RT OccupancyStatus enum (proto index → name). Some decoders surface the
// name directly, others the number; normalise both here.
const OCCUPANCY_NAMES = [
  "EMPTY", "MANY_SEATS_AVAILABLE", "FEW_SEATS_AVAILABLE",
  "STANDING_ROOM_ONLY", "CRUSHED_STANDING_ROOM_ONLY",
  "FULL", "NOT_ACCEPTING_PASSENGERS",
];
function occupancyName(v) {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return OCCUPANCY_NAMES[v] ?? null;
  return null;
}

const CURRENT_STATUS_NAMES = ["INCOMING_AT", "STOPPED_AT", "IN_TRANSIT_TO"];
function currentStatusName(v) {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return CURRENT_STATUS_NAMES[v] ?? null;
  return null;
}

// GTFS-RT Alert enums — order matches the proto index list.
const SEVERITY_NAMES = ["UNKNOWN_SEVERITY", "INFO", "WARNING", "SEVERE"];
const CAUSE_NAMES = [
  "UNKNOWN_CAUSE", "OTHER_CAUSE", "TECHNICAL_PROBLEM", "STRIKE", "DEMONSTRATION",
  "ACCIDENT", "HOLIDAY", "WEATHER", "MAINTENANCE", "CONSTRUCTION",
  "POLICE_ACTIVITY", "MEDICAL_EMERGENCY",
];
const EFFECT_NAMES = [
  "NO_SERVICE", "REDUCED_SERVICE", "SIGNIFICANT_DELAYS", "DETOUR",
  "ADDITIONAL_SERVICE", "MODIFIED_SERVICE", "OTHER_EFFECT", "UNKNOWN_EFFECT",
  "STOP_MOVED", "NO_EFFECT", "ACCESSIBILITY_ISSUE",
];
const mapEnum = (list) => (v) => {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return list[v] ?? null;
  return null;
};
const normalizeSeverity = mapEnum(SEVERITY_NAMES);
const normalizeCause = mapEnum(CAUSE_NAMES);
const normalizeEffect = mapEnum(EFFECT_NAMES);

function buildSegments(network) {
  const byId = new Map(network.stations.map((s) => [s.id, s]));
  const out = [];
  for (const line of network.lines) {
    for (let i = 0; i < line.stations.length - 1; i++) {
      const a = byId.get(line.stations[i]);
      const b = byId.get(line.stations[i + 1]);
      if (!a || !b) continue;
      out.push({
        lineId: line.id,
        lineGroup: line.line,
        mode: line.mode ?? "subway",
        color: line.color,
        direction: 1,
        a, b,
      });
      out.push({
        lineId: line.id,
        lineGroup: line.line,
        mode: line.mode ?? "subway",
        color: line.color,
        direction: -1,
        a: b, b: a,
      });
    }
  }
  return out;
}

function projectOntoSegment(lat, lon, seg) {
  // Approximate to planar. Haversine-based.
  const degLat = 110574;
  const degLon = 111320 * Math.cos((seg.a.lat * Math.PI) / 180);
  const ax = (seg.a.lon * degLon);
  const ay = (seg.a.lat * degLat);
  const bx = (seg.b.lon * degLon);
  const by = (seg.b.lat * degLat);
  const px = (lon * degLon);
  const py = (lat * degLat);
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1) {
    const d = haversine({ lat, lon }, seg.a);
    return { progress: 0, distanceM: d };
  }
  let t = ((px - ax) * abx + (py - ay) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * abx;
  const projY = ay + t * aby;
  const dx = px - projX;
  const dy = py - projY;
  const distanceM = Math.sqrt(dx * dx + dy * dy);
  return { progress: t, distanceM };
}

function findStationByStopId(network, stopId) {
  // stopId from GTFS-RT may not match our station ids; try last-5-digit match
  const suffix = String(stopId).slice(-5);
  for (const s of network.stations) {
    // Not reliable without stop_id mapping; skip for now
  }
  return null;
}
