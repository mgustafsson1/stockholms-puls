const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const SYSTEM_PROMPT = `Du är AI-analytiker för Stockholms tunnelbana.
Du tar emot ögonblicksbilder av realtidstrafik och ska beskriva läget kortfattat och peka på avvikelser, mönster och risker.
Skriv på svenska. Var koncis, konkret och trafikspecifik.
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

function describeTrafficForPrompt(snapshot, network, history) {
  const byLineGroup = { red: [], green: [], blue: [] };
  for (const t of snapshot.trains) {
    if (byLineGroup[t.lineGroup]) byLineGroup[t.lineGroup].push(t);
  }

  const counts = { total: snapshot.trains.length, ok: 0, delayed: 0, stopped: 0 };
  for (const t of snapshot.trains) counts[t.status]++;

  const lineStats = Object.entries(byLineGroup).map(([lg, arr]) => {
    const delayed = arr.filter((t) => t.status === "delayed").length;
    const stopped = arr.filter((t) => t.status === "stopped").length;
    const label = lg === "red" ? "Röda linjen" : lg === "green" ? "Gröna linjen" : "Blå linjen";
    return `- ${label}: ${arr.length} tåg, ${delayed} försenade, ${stopped} stillastående`;
  });

  const anomalies = snapshot.trains
    .filter((t) => t.status !== "ok")
    .slice(0, 8)
    .map((t) => {
      const from = network.stations.find((s) => s.id === t.from)?.name ?? t.from;
      const to = network.stations.find((s) => s.id === t.to)?.name ?? t.to;
      const statusSv = t.status === "stopped" ? "stillastående" : "försenat";
      return `  - ${t.lineId} ${from} → ${to}: ${statusSv} ${Math.round(t.delay)}s`;
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

  return `Tidpunkt ${ts}
Totalt ${counts.total} tåg. I tid: ${counts.ok}, försenade: ${counts.delayed}, stillastående: ${counts.stopped}.

Per linje:
${lineStats.join("\n")}

Aktiva störningar:
${alertLines.length ? alertLines.join("\n") : "  (inga)"}

Avvikande tåg:
${anomalies.length ? anomalies.join("\n") : "  (inga)"}

${trend}`;
}

export class AIAnalyst {
  constructor({ getSnapshot, network, intervalMs = 90_000 }) {
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

    if (!this.apiKey) {
      console.warn("[ai-analyst] no OPENROUTER_KEY set — AI analysis disabled");
      return;
    }

    this.runNow().catch(() => {});
    this.handle = setInterval(() => this.runNow().catch(() => {}), this.intervalMs);
  }

  on(fn) {
    this.listeners.add(fn);
    if (this.latest) fn(this.latest);
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

      const userContent = describeTrafficForPrompt(snap, this.network, this.history);
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
            { role: "system", content: SYSTEM_PROMPT },
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
        summary: String(parsed.summary ?? ""),
        observations: Array.isArray(parsed.observations) ? parsed.observations.map(String).slice(0, 4) : [],
        patterns: Array.isArray(parsed.patterns) ? parsed.patterns.map(String).slice(0, 3) : [],
        mood: ["calm", "watch", "stressed"].includes(parsed.mood) ? parsed.mood : "watch",
      };
      this.lastError = null;
      console.log(`[ai-analyst] ${this.latest.mood.toUpperCase()} · ${this.latest.summary}`);
      this.emit();
    } catch (err) {
      this.lastError = err.message;
      console.warn("[ai-analyst] failed:", err.message);
      this.emit();
    } finally {
      this.inflight = false;
    }
  }

  emit() {
    const payload = { latest: this.latest, error: this.lastError };
    for (const fn of this.listeners) {
      try { fn(payload); } catch {}
    }
  }

  stop() {
    this.stopped = true;
    if (this.handle) clearInterval(this.handle);
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
