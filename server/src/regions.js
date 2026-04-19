// Region config shared by build script and server runtime.
// Adding a new region requires: a Samtrafiken operator slug that the
// configured TRAFIKLAB_KEY has access to, and an agency prefix in routes.txt
// so we can filter routes from the sweden-wide GTFS dump.

const DEFAULT_MATCH = {
  matchMaxMeters: 200,
  matchMaxMetersForced: 200,
  ferryMaxMeters: 2500,
};

export const REGIONS = [
  {
    id: "stockholm",
    label: "Stockholm",
    operator: "sl",
    operatorPrefixes: ["9011001"],
    origin: { lat: 59.3308, lon: 18.0589, label: "T-Centralen" },
    bbox: { minLat: 59.05, maxLat: 59.75, minLon: 17.55, maxLon: 18.55 },
    keepExistingSubway: true,
    useTripMap: true,
    matchMaxMeters: 400,
    matchMaxMetersForced: 600,
    ferryMaxMeters: 2500,
  },
  {
    id: "uppsala",
    label: "Uppsala",
    operator: "ul",
    operatorPrefixes: ["9011003", "9011636"],
    origin: { lat: 59.8586, lon: 17.6389, label: "Uppsala C" },
    bbox: { minLat: 59.3, maxLat: 60.4, minLon: 16.8, maxLon: 18.5 },
    useTripMap: false,
    ...DEFAULT_MATCH,
  },
  {
    id: "ostergotland",
    label: "Östergötland",
    operator: "otraf",
    operatorPrefixes: ["9011005"],
    origin: { lat: 58.4108, lon: 15.6214, label: "Linköping C" },
    bbox: { minLat: 57.8, maxLat: 59.0, minLon: 14.7, maxLon: 17.1 },
    useTripMap: false,
    ...DEFAULT_MATCH,
  },
  {
    id: "jonkoping",
    label: "Jönköping",
    operator: "jlt",
    operatorPrefixes: ["9011006"],
    origin: { lat: 57.7821, lon: 14.1607, label: "Jönköping C" },
    bbox: { minLat: 57.0, maxLat: 58.6, minLon: 13.0, maxLon: 15.9 },
    useTripMap: false,
    ...DEFAULT_MATCH,
  },
  {
    id: "kalmar",
    label: "Kalmar",
    operator: "klt",
    operatorPrefixes: ["9011008"],
    origin: { lat: 56.6620, lon: 16.3580, label: "Kalmar C" },
    bbox: { minLat: 56.0, maxLat: 58.1, minLon: 14.8, maxLon: 17.2 },
    useTripMap: false,
    ...DEFAULT_MATCH,
  },
  {
    id: "blekinge",
    label: "Blekinge",
    operator: "blekinge",
    operatorPrefixes: ["9011010", "9011636"],
    origin: { lat: 56.1616, lon: 15.5866, label: "Karlskrona C" },
    bbox: { minLat: 55.9, maxLat: 56.5, minLon: 14.3, maxLon: 16.2 },
    useTripMap: false,
    ...DEFAULT_MATCH,
  },
  {
    id: "skane",
    label: "Skåne",
    operator: "skane",
    operatorPrefixes: ["9011012", "9011636"],
    origin: { lat: 55.6094, lon: 13.0020, label: "Malmö C" },
    bbox: { minLat: 55.3, maxLat: 56.6, minLon: 12.3, maxLon: 14.5 },
    useTripMap: false,
    ...DEFAULT_MATCH,
  },
  {
    id: "varmland",
    label: "Värmland",
    operator: "varm",
    operatorPrefixes: ["9011017"],
    origin: { lat: 59.3793, lon: 13.5036, label: "Karlstad C" },
    bbox: { minLat: 58.5, maxLat: 60.5, minLon: 11.5, maxLon: 15.0 },
    useTripMap: false,
    ...DEFAULT_MATCH,
  },
  {
    id: "gavleborg",
    label: "Gävleborg",
    operator: "xt",
    operatorPrefixes: ["9011021"],
    origin: { lat: 60.6749, lon: 17.1413, label: "Gävle C" },
    bbox: { minLat: 60.2, maxLat: 62.5, minLon: 14.5, maxLon: 18.5 },
    useTripMap: false,
    ...DEFAULT_MATCH,
  },
];

// Everything else (dt, halland, krono, orebro, vastmanland, dintur, gotland,
// etc.) only publishes bus routes in the static GTFS for this key, so we
// can't draw rail segments for them — adding them would produce empty maps.

export function regionById(id) {
  return REGIONS.find((r) => r.id === id) ?? null;
}
