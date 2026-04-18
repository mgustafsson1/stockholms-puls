const EARTH_R = 6371000;

export function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

export function lerpLatLon(a, b, t) {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
    depth: (a.depth ?? 0) + ((b.depth ?? 0) - (a.depth ?? 0)) * t,
  };
}
