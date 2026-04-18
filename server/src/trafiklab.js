const GTFS_RT_VEHICLE_URL =
  "https://opendata.samtrafiken.se/gtfs-rt-sweden/sl/VehiclePositionsSweden.pb";
const GTFS_RT_ALERTS_URL =
  "https://opendata.samtrafiken.se/gtfs-rt-sweden/sl/ServiceAlertsSweden.pb";

export function hasTrafiklabKey() {
  return !!process.env.TRAFIKLAB_KEY;
}

export async function fetchVehiclePositions() {
  if (!hasTrafiklabKey()) return null;
  try {
    const url = `${GTFS_RT_VEHICLE_URL}?key=${process.env.TRAFIKLAB_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.arrayBuffer();
  } catch (err) {
    console.warn("[trafiklab] vehicle fetch failed:", err.message);
    return null;
  }
}

export async function fetchServiceAlerts() {
  if (!hasTrafiklabKey()) return null;
  try {
    const url = `${GTFS_RT_ALERTS_URL}?key=${process.env.TRAFIKLAB_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.arrayBuffer();
  } catch (err) {
    console.warn("[trafiklab] alerts fetch failed:", err.message);
    return null;
  }
}
