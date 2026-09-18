import { prisma } from "./prisma";
import { DRIVER_NET_PCT_MAX, DRIVER_NET_PCT_MIN } from "./fare";

// Commission bounds mirror fare.ts's driver-net bounds, expressed as a
// percentage (15-30%) the way the admin UI edits it.
export const COMMISSION_PCT_MIN = Math.round((1 - DRIVER_NET_PCT_MAX) * 100); // 15
export const COMMISSION_PCT_MAX = Math.round((1 - DRIVER_NET_PCT_MIN) * 100); // 30

export function clampCommissionPct(pct: number): number {
  return Math.min(COMMISSION_PCT_MAX, Math.max(COMMISSION_PCT_MIN, pct));
}

// PlatformConfig is a single-row settings table. This lazily creates the
// default row on first read so `npm run setup` never needs a manual step —
// the seed script also creates one explicitly with the spec's starting
// defaults (15% commission / 85% driver net).
export async function getPlatformConfig() {
  const existing = await prisma.platformConfig.findFirst();
  if (existing) return existing;
  return prisma.platformConfig.create({ data: {} });
}

export async function driverNetPctFromConfig(): Promise<number> {
  const config = await getPlatformConfig();
  const commissionPct = clampCommissionPct(Number(config.commissionPct));
  return (100 - commissionPct) / 100;
}
