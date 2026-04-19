const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const MODE_LABEL_SV = {
  subway: "tunnelbana",
  rail: "pendeltåg",
  lightrail: "lokalbana",
  tram: "spårvagn",
  ferry: "pendelbåt",
  bus: "buss",
};

function buildSystemPrompt(regionLabel, modeSummary) {
  const modes = modeSummary.length ? modeSummary.join(", ") : "kollektivtrafik";
  return `Du är AI-analytiker för ${regionLabel}s kollektivtrafik (${modes}).
Du tar emot ögonblicksbilder av realtidstrafik och ska beskriva läget kortfattat och peka på avvikelser, mönster och risker.
Skriv på svenska. Var koncis, konkret och trafikspecifik. Utgå ENDAST från den region och de trafikslag som listas ovan — nämn inte andra regioner.
Svara ALLTID som rent JSON enligt schemat:
{
  "summary": "en rad som beskriver det övergripande läget",
  "observations": ["..", ".."],
  "patterns": ["..", ".."],
  "mood": "calm" | "watch" | "stressed"
}
Ingen markdown, ingen extra text — bara JSON-objektet.
- summary: max 110 tecken.
- observations: 2–4 korta punkter (max ~80 tecken per punkt). Konkreta: linje, plats, delay, orsak.
- patterns: 0–3 korta punkter om trender eller systempåverkan. Undvik upprepning av observations.
- mood: calm = nästan inga förseningar; watch = enstaka avvikelser; stressed = flera linjer påverkade eller stopp.`;
}

function describeTraffic(snapshot, network, history, regionLabel) {
  // Group by lineId (keeps things generic across regions — Stockholm's RGB
  // grouping is still visible because T13+T14 appear side by side etc.).
  const perLine = new Map();
  const modeCounts = new Map();
  for (const t of snapshot.trains) {
    const mode = t.mode ?? "subway";
    modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1);
    const key = t.lineId || "—";
    let bucket = perLine.get(key);
    if (!bucket) {
      bucket = { lineId: key, mode, total: 0, ok: 0, delayed: 0, stopped: 0 };
      perLine.set(key, bucket);
    }
    bucket.total++;
    bucket[t.status]++;
  }

  const counts = { total: snapshot.trains.length, ok: 0, delayed: 0, stopped: 0 };
  for (const t of snapshot.trains) counts[t.status]++;

  const modeLine = Array.from(modeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${MODE_LABEL_SV[m] ?? m} ${n}`)
    .join(", ");

  // Only list lines with some activity; skip buses when listing per-line rows
  // (too noisy — we summarise bus count via the mode line instead).
  const lineRows = Array.from(perLine.values())
    .filter((b) => b.mode !== "bus" && b.total > 0)
    .sort((a, b) => b.stopped + b.delayed - (a.stopped + a.delayed) || b.total - a.total)
    .slice(0, 12)
    .map((b) => `- ${b.lineId} (${MODE_LABEL_SV[b.mode] ?? b.mode}): ${b.total} fordon, ${b.delayed} försenade, ${b.stopped} stillastående`);
  const busCount = modeCounts.get("bus") ?? 0;
  if (busCount > 0) {
    const busDelayed = Array.from(perLine.values()).filter((b) => b.mode === "bus").reduce((s, b) => s + b.delayed, 0);
    const busStopped = Array.from(perLine.values()).filter((b) => b.mode === "bus").reduce((s, b) => s + b.stopped, 0);
    lineRows.push(`- Buss (alla linjer): ${busCount} fordon, ${busDelayed} försenade, ${busStopped} stillastående`);
  }

  const anomalies = snapshot.trains
    .filter((t) => t.status !== "ok")
    .slice(0, 8)
    .map((t) => {
      const from = network.stations.find((s) => s.id === t.from)?.name ?? (t.from ?? "");
      const to = network.stations.find((s) => s.id === t.to)?.name ?? (t.to ?? "");
      const statusSv = t.status === "stopped" ? "stillastående" : "försenat";
      const route = from && to ? `${from} → ${to}` : from || to || "okänd position";
      return `  - ${t.lineId} ${route}: ${statusSv} ${Math.round(t.delay)}s`;
    });

  const alertLines = (snapshot.alerts ?? []).slice(0, 6).map((a) => {
    const age = Math.round((Date.now() - a.createdAt) / 1000);
    return `  - ${a.message} · ${a.stationName} (för ${age}s sedan)`;
  });

  const trend = history.length >= 2
    ? (() => {
        const prev = history[history.length - 2];
        const curr = history[history.length - 1];
        const d = curr.delayed - prev.delayed;
        const s = curr.stopped - prev.stopped;
        const sign = (x) => (x > 0 ? `+${x}` : `${x}`);
        return `Trend sedan förra sample: försenade ${sign(d)}, stillastående ${sign(s)}`;
      })()
    : "Trend: första mätpunkten.";

  const ts = new Date(snapshot.t).toLocaleTimeString("sv-SE");

  return `Region: ${regionLabel}
Tidpunkt ${ts}
Totalt ${counts.total} fordon (${modeLine || "inga"}). I tid: ${counts.ok}, försenade: ${counts.delayed}, stillastående: ${counts.stopped}.

Per linje:
${lineRows.length ? lineRows.join("\n") : "  (inga aktiva linjer)"}

Aktiva störningar:
${alertLines.length ? alertLines.join("\n") : "  (inga)"}

Avvikande fordon:
${anomalies.length ? anomalies.join("\n") : "  (inga)"}

${trend}`;
}

export class AIAnalyst {
  constructor({ regionId, regionLabel, getSnapshot, network, intervalMs = 90_000 }) {
    this.regionId = regionId;
    this.regionLabel = regionLabel || regionId;
    this.getSnapshot = getSnapshot;
    this.network = network;
    this.intervalMs = intervalMs;
    this.listeners = new Set();
    this.latest = null;
    this.history = [];
    this.inflight = false;
    this.apiKey = process.env.OPENROUTER_KEY ?? process.env.OPENROUTER_API_KEY ?? null;
    this.stopped = false;
    this.lastError = null;
    this.refCount = 0;
    this.handle = null;

    // Precompute the mode summary used in the system prompt. We base this on
    // what the network declares; if zero vehicles are flowing the prompt still
    // tells the model what kinds of traffic to expect.
    const modesInNetwork = new Set();
    for (const line of network.lines) modesInNetwork.add(line.mode ?? "subway");
    this.modeSummary = Array.from(modesInNetwork).map((m) => MODE_LABEL_SV[m] ?? m);

    if (!this.apiKey) {
      console.warn(`[ai-analyst:${this.regionId}] no OPENROUTER_KEY — disabled`);
    }
  }

  // Called by WS subscribe/unsubscribe. Run analysis only when someone is
  // watching, stop when the viewer count drops to 0 (saves LLM cost).
  acquire() {
    this.refCount++;
    if (this.refCount === 1 && this.apiKey && !this.handle) {
      this.stopped = false;
      this.runNow().catch(() => {});
      this.handle = setInterval(() => this.runNow().catch(() => {}), this.intervalMs);
      console.log(`[ai-analyst:${this.regionId}] started (viewers=${this.refCount})`);
    }
  }

  release() {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0 && this.handle) {
      clearInterval(this.handle);
      this.handle = null;
      console.log(`[ai-analyst:${this.regionId}] idle — paused`);
    }
  }

  on(fn) {
    this.listeners.add(fn);
    if (this.latest) fn({ latest: this.latest, error: this.lastError });
    return () => this.listeners.delete(fn);
  }

  async runNow() {
    if (!this.apiKey || this.inflight || this.stopped) return;
    this.inflight = true;
    try {
      const snap = this.getSnapshot();
      this.history.push({
        t: snap.t,
        delayed: snap.trains.filter((x) => x.status === "delayed").length,
        stopped: snap.trains.filter((x) => x.status === "stopped").length,
      });
      if (this.history.length > 8) this.history.shift();

      const systemPrompt = buildSystemPrompt(this.regionLabel, this.modeSummary);
      const userContent = describeTraffic(snap, this.network, this.history, this.regionLabel);
      const started = Date.now();

      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost",
          "X-Title": "Stockholms Puls",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_object" },
          temperature: 0.4,
          max_tokens: 450,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content ?? "";
      const parsed = safeParse(content);
      if (!parsed) throw new Error(`could not parse JSON: ${content.slice(0, 160)}`);

      const elapsed = Date.now() - started;
      this.latest = {
        createdAt: Date.now(),
        elapsedMs: elapsed,
        model: MODEL,
        snapshotTime: snap.t,
        regionId: this.regionId,
        summary: String(parsed.summary ?? ""),
        observations: Array.isArray(parsed.observations) ? parsed.observations.map(String).slice(0, 4) : [],
        patterns: Array.isArray(parsed.patterns) ? parsed.patterns.map(String).slice(0, 3) : [],
        mood: ["calm", "watch", "stressed"].includes(parsed.mood) ? parsed.mood : "watch",
      };
      this.lastError = null;
      console.log(`[ai-analyst:${this.regionId}] ${this.latest.mood.toUpperCase()} · ${this.latest.summary}`);
      this.emit();
    } catch (err) {
      this.lastError = err.message;
      console.warn(`[ai-analyst:${this.regionId}] failed:`, err.message);
      this.emit();
    } finally {
      this.inflight = false;
    }
  }

  emit() {
    const payload = { latest: this.latest, error: this.lastError, regionId: this.regionId };
    for (const fn of this.listeners) {
      try { fn(payload); } catch {}
    }
  }

  stop() {
    this.stopped = true;
    if (this.handle) { clearInterval(this.handle); this.handle = null; }
  }
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    const match = s.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return null; }
    }
    return null;
  }
}
