// Point-in-polygon geofence containment (SQLite has no PostGIS).
// Polygons are stored as JSON strings of [lat, lng] vertex pairs on
// GeofenceZone.boundaryPolygonJson. This uses the standard ray-casting
// algorithm, which is a faithful in-process substitute for PostGIS's
// ST_Contains for the small, non-self-intersecting polygons used here.

export type LatLng = { lat: number; lng: number };

export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  const { lat: y, lng: x } = point;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function parsePolygon(json: string): LatLng[] {
  const raw = JSON.parse(json) as [number, number][];
  return raw.map(([lat, lng]) => ({ lat, lng }));
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
