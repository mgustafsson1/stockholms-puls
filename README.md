# Stockholms Puls

Realtidsvisualisering av Stockholms tunnelbana i 3D. Centrum expanderas, underjorden blir synlig, och en AI-analytiker kommenterar trafikläget var 45:e sekund.

![Screenshot](docs/screenshot.png)

## Vad det är

En webbapp som renderar hela t-banenätet som lysande tunnlar under en transparent stadsgrid. Varje tåg är en partikel som rör sig längs sin linje. Stationer skalar upp efter aktivitet, djupet under mark visas som kolumn upp mot ytan, störningar blir pulserande pelare.

**Nyckelfunktioner**
- Alla 7 linjer (T10, T11, T13, T14, T17, T18, T19) med ~100 stationer
- Realtid via Trafiklab GTFS-RT, med inbyggd simulator som fallback
- 3D-scen med React Three Fiber + postprocessing (bloom, vignette)
- Station-klick → avgångstavla med ETA för alla kommande tåg
- Tåg-klick → panel med linje, status, försening, djup, koordinater, följ-kamera
- AI-analytiker via OpenRouter (Gemini) som beskriver trafikläget kontinuerligt
- Flödespulser längs tunnlar, djupmarkörer, larm-kolumner

## Kom igång

```bash
git clone <repo>
cd <repo>
npm run install:all
cp .env.example server/.env   # fyll i valfria nycklar
npm run dev
```

Öppna [http://localhost:5173](http://localhost:5173).

Utan några miljövariabler: appen kör i simulator-läge, AI-panelen är inaktiv. Med `TRAFIKLAB_KEY` hämtas riktig trafik, med `OPENROUTER_KEY` börjar AI-analytikern köra.

## Arkitektur

```
.
├── server/                  Express + WebSocket + simulator + AI-analytiker
│   ├── src/
│   │   ├── index.js         HTTP/WS entry
│   │   ├── simulator.js     Genererar realistisk tågtrafik när Trafiklab saknas
│   │   ├── trafiklab.js     GTFS-RT fetch
│   │   ├── aiAnalyst.js     OpenRouter-anrop var N sekund
│   │   └── geo.js           Haversine, lerp
│   └── data/network.json    ~100 stationer, 7 linjer, koordinater + djup
└── client/                  Vite + React + Three.js
    └── src/
        ├── scene/           3D-komponenter (CityBase, TunnelNetwork, Trains, Stations, FlowPulses, AlertHalos, Labels, Camera)
        ├── ui/              HTML-overlay (Header, Controls, Legend, InfoPanel, StationInfoPanel, AIPanel, Alerts)
        └── data/            Projektion, store (zustand), WebSocket-hook, station-board-logik
```

**Pipeline**

1. Simulator (eller Trafiklab-proxy) genererar tågpositioner varje sekund.
2. Server broadcastar över WebSocket (`/stream`).
3. Klienten lerpar mellan snapshots för mjuk rörelse.
4. AI-analytiker kör parallellt, samlar aggregerade stats, skickar till OpenRouter, broadcastar JSON-svar till klienten.

## Miljövariabler

| Variabel | Standard | Beskrivning |
|---|---|---|
| `TRAFIKLAB_KEY` | — | Trafiklab Open API-nyckel för GTFS-RT. Utan denna används simulatorn. |
| `OPENROUTER_KEY` | — | OpenRouter-nyckel för AI-analytikern. Utan denna är AI-panelen inaktiv. |
| `AI_INTERVAL_MS` | `90000` | Hur ofta AI-analysen körs (ms). |
| `PORT` | `4000` | Backend-port. Vite-proxyn förutsätter denna. |

## Stack

- **Frontend**: React 18, TypeScript, Vite, Three.js, @react-three/fiber, @react-three/drei, @react-three/postprocessing, zustand
- **Backend**: Node 18+, Express, ws
- **AI**: OpenRouter → `google/gemini-3-flash-preview`
- **Data**: Trafiklab GTFS-RT (Vehicle Positions, Trip Updates, Service Alerts)

## Skalor

Horisontellt: 1:300 (linjär, 1 scenhet ≈ 300 m). Djupet: ~1:10 mot horisontal — verkliga djup men något nedtonade för läsbarhet. Stationsdjup hämtat från SL:s offentliga stationsdata och Wikipedia; vissa avrundningar förekommer.

## Licens

MIT.
