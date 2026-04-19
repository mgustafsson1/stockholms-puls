// Region config shared by build script and server runtime.
// Adding a new region requires: a Samtrafiken operator slug that the
// configured TRAFIKLAB_KEY has access to, and an agency prefix in routes.txt
// so we can filter routes from the sweden-wide GTFS dump.

export const REGIONS = [
  {
    id: "stockholm",
    label: "Stockholm",
    operator: "sl",
    operatorPrefixes: ["9011001"],
    origin: { lat: 59.3308, lon: 18.0589, label: "T-Centralen" },
    bbox: { minLat: 59.05, maxLat: 59.75, minLon: 17.55, maxLon: 18.55 },
    keepExistingSubway: true,
    matchMaxMeters: 400,
    matchMaxMetersForced: 600,
    ferryMaxMeters: 2500,
  },
  {
    id: "skane",
    label: "Skåne",
    operator: "skane",
    operatorPrefixes: ["9011012", "9011008", "9011636"],
    origin: { lat: 55.6094, lon: 13.0020, label: "Malmö C" },
    bbox: { minLat: 55.3, maxLat: 56.6, minLon: 12.3, maxLon: 14.5 },
    keepExistingSubway: false,
    // Our sweden-wide GTFS is from December — Skåne trip_ids have since
    // rotated and don't match the live feed. Skip the trip map and rely on
    // tight geographic matching instead (buses won't snap to rail corridors).
    useTripMap: false,
    matchMaxMeters: 180,
    matchMaxMetersForced: 180,
    ferryMaxMeters: 1800,
  },
  {
    id: "blekinge",
    label: "Blekinge",
    operator: "blekinge",
    operatorPrefixes: ["9011006", "9011636"],
    origin: { lat: 56.1616, lon: 15.5866, label: "Karlskrona C" },
    bbox: { minLat: 55.9, maxLat: 56.5, minLon: 14.3, maxLon: 16.2 },
    keepExistingSubway: false,
    useTripMap: false,
    matchMaxMeters: 200,
    matchMaxMetersForced: 200,
    ferryMaxMeters: 2500,
  },
];

export function regionById(id) {
  return REGIONS.find((r) => r.id === id) ?? null;
}
