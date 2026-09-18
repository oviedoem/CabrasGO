// CabrasGo fare engine — implements the polynomial fare algorithm from
// section 3 of the technical manual, as refined by the unified spec
// (fases 1.1-1.4):
//
//   Tarifa = [ B + (D_pav * C_pav) + (D_ripio * C_ripio) + (T_est * C_min) ]
//            * M_estival * F_combustible
//
//   B        = bajada de bandera = $1.200 CLP
//   C_pav    = $350 CLP/km (asfalto, Ruta H-66 / Av. O'Higgins)
//   C_ripio  = $550 CLP/km (ripio compactado / huella ribereña)
//   C_min    = $120 CLP/minuto estimado de viaje
//   M_estival = multiplicador dinámico geocercado (ej. 1.35x Llallauquén / Marina Golf)
//   F_combustible = 1 + ((precioPromedioActual - 1.250) / 1.250 * 0.25)
//
// Banda de amortiguación: si |F_combustible - 1.00| < 0.02, F se redondea a 1.00
// (evita fluctuaciones menores a ~10 CLP en perjuicio del pasajero).
//
// Precio de referencia (fuel sync trigger): el promedio CNE/ENAP sólo se
// vuelve a indexar cuando cambia más de $25 CLP/L respecto del último
// benchmark registrado (ver src/routes/admin.ts -> POST /fuel/sync-cne).

export const BAJADA_DE_BANDERA_CLP = 1200;
export const TARIFA_KM_ASFALTO_CLP = 350;
export const TARIFA_KM_RIPIO_CLP = 550;
export const TARIFA_MIN_ESTIMADO_CLP = 120;
export const PRECIO_COMBUSTIBLE_REFERENCIA_CLP = 1250;
export const FUEL_FACTOR_DAMPING_THRESHOLD = 0.02;
export const FUEL_PRICE_SYNC_TRIGGER_CLP = 25;

// Average driving speed used to estimate trip duration from distance, blended
// for mixed paved/dirt rural roads around Lago Rapel (~38 km/h average).
const AVG_SPEED_KMH = 38;

export function estimateTripMinutes(distanceKmTotal: number): number {
  return (distanceKmTotal / AVG_SPEED_KMH) * 60;
}

export function computeFuelFactor(avgFuelPriceClp: number): number {
  const raw =
    1 +
    ((avgFuelPriceClp - PRECIO_COMBUSTIBLE_REFERENCIA_CLP) /
      PRECIO_COMBUSTIBLE_REFERENCIA_CLP) *
      0.25;
  if (Math.abs(raw - 1.0) < FUEL_FACTOR_DAMPING_THRESHOLD) return 1.0;
  return Math.round(raw * 1000) / 1000;
}

export interface FareInput {
  distanceKmPaved: number;
  distanceKmDirt: number;
  dynamicMultiplier: number; // M_estival, from geofence
  avgFuelPriceClp: number;
}

export interface FareResult {
  baseFlag: number;
  pavedCost: number;
  dirtCost: number;
  timeCost: number;
  subtotal: number;
  dynamicMultiplier: number;
  fuelFactor: number;
  estimatedMinutes: number;
  totalFareClp: number;
}

export function computeFare(input: FareInput): FareResult {
  const distanceKmTotal = input.distanceKmPaved + input.distanceKmDirt;
  const estimatedMinutes = estimateTripMinutes(distanceKmTotal);

  const baseFlag = BAJADA_DE_BANDERA_CLP;
  const pavedCost = input.distanceKmPaved * TARIFA_KM_ASFALTO_CLP;
  const dirtCost = input.distanceKmDirt * TARIFA_KM_RIPIO_CLP;
  const timeCost = estimatedMinutes * TARIFA_MIN_ESTIMADO_CLP;

  const subtotal = baseFlag + pavedCost + dirtCost + timeCost;
  const fuelFactor = computeFuelFactor(input.avgFuelPriceClp);
  const totalFareClp = Math.round(
    subtotal * input.dynamicMultiplier * fuelFactor
  );

  return {
    baseFlag,
    pavedCost: Math.round(pavedCost),
    dirtCost: Math.round(dirtCost),
    timeCost: Math.round(timeCost),
    subtotal: Math.round(subtotal),
    dynamicMultiplier: input.dynamicMultiplier,
    fuelFactor,
    estimatedMinutes: Math.round(estimatedMinutes),
    totalFareClp,
  };
}

// Driver/platform split — configurable by the admin (PlatformConfig.commissionPct,
// see src/lib/platformConfig.ts) but always bounded to a 70%-85% driver net /
// 15%-30% platform commission range, per the business model spec. Historically
// this was a hardcoded 85/15 split; DEFAULT_DRIVER_NET_PCT keeps that as the
// starting default for anything that doesn't pass an explicit percentage.
export const DRIVER_NET_PCT_MIN = 0.7;
export const DRIVER_NET_PCT_MAX = 0.85;
export const DEFAULT_DRIVER_NET_PCT = 0.85;

export function clampDriverNetPct(pct: number): number {
  return Math.min(DRIVER_NET_PCT_MAX, Math.max(DRIVER_NET_PCT_MIN, pct));
}

export function splitFare(totalFareClp: number, driverNetPct: number = DEFAULT_DRIVER_NET_PCT) {
  const clamped = clampDriverNetPct(driverNetPct);
  const driverNetClp = Math.round(totalFareClp * clamped);
  const platformFeeClp = totalFareClp - driverNetClp;
  return { driverNetClp, platformFeeClp };
}

// Rural 4x4 fleet carries a small category premium vs standard sedan.
export const CATEGORY_MULTIPLIER: Record<string, number> = {
  STANDARD_SEDAN: 1.0,
  RURAL_4X4_XL: 1.22,
};
