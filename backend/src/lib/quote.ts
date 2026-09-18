import { prisma } from "./prisma";
import { haversineKm, parsePolygon, pointInPolygon, LatLng } from "./geofence";
import { CATEGORY_MULTIPLIER, computeFare } from "./fare";

export interface QuoteParams {
  origin: LatLng & { address?: string };
  destination: LatLng & { address?: string };
}

export async function resolveGeofence(point: LatLng) {
  const zones = await prisma.geofenceZone.findMany();
  for (const zone of zones) {
    const polygon = parsePolygon(zone.boundaryPolygonJson);
    if (pointInPolygon(point, polygon)) return zone;
  }
  return null;
}

export async function avgFuelPriceClp(): Promise<number> {
  const benchmarks = await prisma.fuelBenchmark.findMany();
  if (!benchmarks.length) return 1250;
  const sum = benchmarks.reduce((acc, b) => acc + b.gasoline93Clp, 0);
  return sum / benchmarks.length;
}

export async function buildQuote(params: QuoteParams) {
  const distanceKmTotal = haversineKm(params.origin, params.destination);

  const destZone = await resolveGeofence(params.destination);
  const originZone = await resolveGeofence(params.origin);
  const zone = destZone ?? originZone;

  // Heuristic dirt-road fraction: rural/lakeside zones (Llallauquén, El Manzano,
  // Marina Golf) have a higher proportion of ripio/huella ribereña; the urban
  // centro zone is mostly paved Ruta H-66 / Av. O'Higgins.
  const ruralZones = ["LLALLAUQUEN", "EL_MANZANO", "MARINA_GOLF_RAPEL"];
  const dirtFraction = zone && ruralZones.includes(zone.code) ? 0.35 : 0.08;
  const distanceKmDirt = Math.round(distanceKmTotal * dirtFraction * 100) / 100;
  const distanceKmPaved = Math.round((distanceKmTotal - distanceKmDirt) * 100) / 100;

  const dynamicMultiplier = zone ? Number(zone.dynamicMultiplier) : 1.0;
  const fuelPrice = await avgFuelPriceClp();
  const require4x4 = zone?.require4x4 ?? false;

  const categories = (["STANDARD_SEDAN", "RURAL_4X4_XL"] as const)
    .filter((cat) => !(require4x4 && cat === "STANDARD_SEDAN"))
    .map((category) => {
      const fare = computeFare({
        distanceKmPaved,
        distanceKmDirt,
        dynamicMultiplier,
        avgFuelPriceClp: fuelPrice,
      });
      const catMultiplier = CATEGORY_MULTIPLIER[category];
      const totalFareClp = Math.round(fare.totalFareClp * catMultiplier);
      const etaMinutes = category === "RURAL_4X4_XL" ? 6 : 4;
      return {
        category,
        etaMinutes,
        totalFareClp,
        recommended: require4x4 && category === "RURAL_4X4_XL",
        breakdown: { ...fare, totalFareClp },
      };
    });

  return {
    distanceTotalKm: Math.round(distanceKmTotal * 100) / 100,
    distanceDirtKm: distanceKmDirt,
    distancePavedKm: distanceKmPaved,
    categories,
    geofenceZone: zone?.code ?? null,
    geofenceZoneName: zone?.name ?? null,
    dynamicMultiplier,
    require4x4,
    fuelPriceClp: Math.round(fuelPrice),
  };
}
