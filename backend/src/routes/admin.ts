import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../lib/auth";
import { parsePolygon } from "../lib/geofence";
import { FUEL_PRICE_SYNC_TRIGGER_CLP } from "../lib/fare";
import { LANDMARKS } from "../lib/landmarks";

export const adminRouter = Router();

adminRouter.get("/kpis/realtime", requireAuth("ADMIN", "DISPATCHER"), async (_req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [completedToday, cancelledToday, activeDrivers, totalDrivers, onTripDrivers, allTripsToday] =
    await Promise.all([
      prisma.trip.count({ where: { status: "COMPLETED", completedAt: { gte: startOfDay } } }),
      prisma.trip.count({ where: { status: "CANCELLED", cancelledAt: { gte: startOfDay } } }),
      prisma.driver.count({ where: { operationalStatus: { not: "OFFLINE" } } }),
      prisma.driver.count(),
      prisma.driver.count({ where: { operationalStatus: "ON_TRIP" } }),
      prisma.trip.findMany({
        where: { requestedAt: { gte: startOfDay }, status: { not: "CANCELLED" } },
        select: { fareGrossClp: true },
      }),
    ]);

  const gmvToday = allTripsToday.reduce((acc, t) => acc + t.fareGrossClp, 0);
  const totalRequested = completedToday + cancelledToday;
  const completionRate = totalRequested > 0 ? (completedToday / totalRequested) * 100 : 100;

  const statusBreakdown = await prisma.driver.groupBy({
    by: ["operationalStatus"],
    _count: true,
  });

  res.json({
    gmvTodayClp: gmvToday,
    activeDrivers,
    totalDrivers,
    onTripDrivers,
    completedTripsToday: completedToday,
    completionRatePct: Math.round(completionRate * 10) / 10,
    fleetStatus: statusBreakdown.map((s) => ({ status: s.operationalStatus, count: s._count })),
  });
});

adminRouter.get("/drivers/radar", requireAuth("ADMIN", "DISPATCHER"), async (_req, res) => {
  const drivers = await prisma.driver.findMany({
    include: { user: true },
  });
  res.json({
    drivers: drivers.map((d) => ({
      id: d.id,
      name: `${d.user.firstName} ${d.user.lastName}`,
      plate: d.vehiclePlate,
      model: d.vehicleModel,
      status: d.operationalStatus,
      lat: d.currentLatitude ? Number(d.currentLatitude) : null,
      lng: d.currentLongitude ? Number(d.currentLongitude) : null,
      speedKmh: d.speedKmh ? Number(d.speedKmh) : 0,
      batteryPct: d.batteryPct,
      rating: Number(d.user.ratingAvg),
      isKycVerified: d.isKycVerified,
    })),
    landmarks: LANDMARKS,
  });
});

adminRouter.get("/users", requireAuth("ADMIN", "DISPATCHER"), async (_req, res) => {
  const users = await prisma.user.findMany({
    include: { driverProfile: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ users });
});

adminRouter.put("/drivers/:id/kyc", requireAuth("ADMIN"), async (req: AuthedRequest, res) => {
  const { isKycVerified } = req.body as { isKycVerified: boolean };
  const driver = await prisma.driver.update({
    where: { id: req.params.id },
    data: { isKycVerified },
  });
  res.json({ driverId: driver.id, isKycVerified: driver.isKycVerified });
});

adminRouter.get("/geofences", requireAuth("ADMIN", "DISPATCHER"), async (_req, res) => {
  const zones = await prisma.geofenceZone.findMany();
  res.json({
    zones: zones.map((z) => ({
      ...z,
      boundaryPolygon: parsePolygon(z.boundaryPolygonJson),
    })),
  });
});

adminRouter.put("/geofences/:code", requireAuth("ADMIN"), async (req: AuthedRequest, res) => {
  const { dynamicMultiplier, require4x4, dirtRoadSurchargeClp, isHighDemand } = req.body as {
    dynamicMultiplier?: number;
    require4x4?: boolean;
    dirtRoadSurchargeClp?: number;
    isHighDemand?: boolean;
  };
  const zone = await prisma.geofenceZone.update({
    where: { code: req.params.code },
    data: {
      ...(dynamicMultiplier !== undefined ? { dynamicMultiplier } : {}),
      ...(require4x4 !== undefined ? { require4x4 } : {}),
      ...(dirtRoadSurchargeClp !== undefined ? { dirtRoadSurchargeClp } : {}),
      ...(isHighDemand !== undefined ? { isHighDemand } : {}),
    },
  });
  res.json({ zone });
});

adminRouter.get("/fuel/benchmarks", requireAuth("ADMIN", "DISPATCHER"), async (_req, res) => {
  const benchmarks = await prisma.fuelBenchmark.findMany({ orderBy: { reportedAt: "desc" } });
  res.json({ benchmarks });
});

// Mocked CNE/ENAP sync webhook: nudges each station's price by a small random
// walk. Per the unified spec, a station is only re-indexed into the fare
// engine's benchmark set when its price moves more than $25 CLP/L vs the last
// reading (FUEL_PRICE_SYNC_TRIGGER_CLP) — smaller noise is ignored.
adminRouter.post("/fuel/sync-cne", requireAuth("ADMIN"), async (_req, res) => {
  const benchmarks = await prisma.fuelBenchmark.findMany();
  const updates = [];
  for (const b of benchmarks) {
    const delta = Math.round((Math.random() - 0.5) * 40); // +/- 20 CLP noise
    if (Math.abs(delta) < FUEL_PRICE_SYNC_TRIGGER_CLP) {
      updates.push({ station: b.stationName, changed: false, gasoline93Clp: b.gasoline93Clp });
      continue;
    }
    const updated = await prisma.fuelBenchmark.update({
      where: { id: b.id },
      data: {
        gasoline93Clp: b.gasoline93Clp + delta,
        dieselClp: b.dieselClp + Math.round(delta * 0.8),
        reportedAt: new Date(),
      },
    });
    updates.push({ station: b.stationName, changed: true, gasoline93Clp: updated.gasoline93Clp });
  }
  res.json({ syncedAt: new Date().toISOString(), source: "CNE_ENAP_SANDBOX", updates });
});

adminRouter.get("/finance/reconciliation", requireAuth("ADMIN"), async (_req, res) => {
  const trips = await prisma.trip.findMany({
    where: { status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    take: 50,
  });
  const byMethod = trips.reduce<Record<string, { count: number; totalClp: number }>>((acc, t) => {
    const key = t.paymentMethod;
    acc[key] = acc[key] ?? { count: 0, totalClp: 0 };
    acc[key].count += 1;
    acc[key].totalClp += t.fareGrossClp;
    return acc;
  }, {});
  res.json({
    trips: trips.map((t) => ({
      id: t.id,
      fareGrossClp: t.fareGrossClp,
      driverNetClp: t.driverNetClp,
      platformFeeClp: t.platformFeeClp,
      paymentMethod: t.paymentMethod,
      paymentStatus: t.paymentStatus,
      paymentGatewayRef: t.paymentGatewayRef,
      completedAt: t.completedAt,
    })),
    byMethod,
    note: "Conciliación exenta según Resolución Exenta SII N°84 (transporte rural) — datos sandbox.",
  });
});
