import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../lib/auth";
import { parsePolygon } from "../lib/geofence";
import { FUEL_PRICE_SYNC_TRIGGER_CLP } from "../lib/fare";
import { LANDMARKS } from "../lib/landmarks";
import { COMMISSION_PCT_MAX, COMMISSION_PCT_MIN, clampCommissionPct, getPlatformConfig } from "../lib/platformConfig";

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
      isVip: d.isVip,
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

// ---- Business/commission model (point 3): platform config, cancellation
// revenue, VIP subscriptions, weekly bonuses, ad campaigns ----

adminRouter.get("/config", requireAuth("ADMIN", "DISPATCHER"), async (_req, res) => {
  const config = await getPlatformConfig();
  res.json({ config, commissionPctMin: COMMISSION_PCT_MIN, commissionPctMax: COMMISSION_PCT_MAX });
});

adminRouter.put("/config", requireAuth("ADMIN"), async (req: AuthedRequest, res) => {
  const body = req.body as {
    commissionPct?: number;
    cancellationFeePassengerClp?: number;
    cancellationFeeDriverClp?: number;
    weeklyBonusTripThreshold?: number;
    weeklyBonusAmountClp?: number;
    vipMonthlyFeeClp?: number;
  };
  const current = await getPlatformConfig();
  const config = await prisma.platformConfig.update({
    where: { id: current.id },
    data: {
      ...(body.commissionPct !== undefined ? { commissionPct: clampCommissionPct(body.commissionPct) } : {}),
      ...(body.cancellationFeePassengerClp !== undefined
        ? { cancellationFeePassengerClp: Math.max(0, Math.round(body.cancellationFeePassengerClp)) }
        : {}),
      ...(body.cancellationFeeDriverClp !== undefined
        ? { cancellationFeeDriverClp: Math.max(0, Math.round(body.cancellationFeeDriverClp)) }
        : {}),
      ...(body.weeklyBonusTripThreshold !== undefined
        ? { weeklyBonusTripThreshold: Math.max(1, Math.round(body.weeklyBonusTripThreshold)) }
        : {}),
      ...(body.weeklyBonusAmountClp !== undefined
        ? { weeklyBonusAmountClp: Math.max(0, Math.round(body.weeklyBonusAmountClp)) }
        : {}),
      ...(body.vipMonthlyFeeClp !== undefined
        ? { vipMonthlyFeeClp: Math.max(0, Math.round(body.vipMonthlyFeeClp)) }
        : {}),
    },
  });
  res.json({ config });
});

adminRouter.put("/drivers/:id/vip", requireAuth("ADMIN"), async (req: AuthedRequest, res) => {
  const { isVip } = req.body as { isVip: boolean };
  const driver = await prisma.driver.update({
    where: { id: req.params.id },
    data: { isVip, vipSince: isVip ? new Date() : null },
  });
  res.json({ driverId: driver.id, isVip: driver.isVip, vipSince: driver.vipSince });
});

adminRouter.get("/bonuses/weekly", requireAuth("ADMIN", "DISPATCHER"), async (_req, res) => {
  const bonuses = await prisma.driverWeeklyBonus.findMany({
    include: { driver: { include: { user: true } } },
    orderBy: { weekStart: "desc" },
    take: 50,
  });
  res.json({
    bonuses: bonuses.map((b) => ({
      id: b.id,
      driverName: `${b.driver.user.firstName} ${b.driver.user.lastName}`,
      weekStart: b.weekStart,
      tripsCompleted: b.tripsCompleted,
      bonusClp: b.bonusClp,
      createdAt: b.createdAt,
    })),
  });
});

adminRouter.get("/ads", requireAuth("ADMIN", "DISPATCHER"), async (_req, res) => {
  const ads = await prisma.adCampaign.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ ads });
});

adminRouter.post("/ads", requireAuth("ADMIN"), async (req: AuthedRequest, res) => {
  const { title, bodyText, imageUrl, targetAudience, active } = req.body as {
    title: string;
    bodyText: string;
    imageUrl?: string;
    targetAudience?: "PASAJERO" | "CONDUCTOR" | "AMBOS";
    active?: boolean;
  };
  if (!title || !bodyText) return res.status(400).json({ error: "title y bodyText son requeridos" });
  const ad = await prisma.adCampaign.create({
    data: {
      title,
      bodyText,
      imageUrl: imageUrl ?? null,
      targetAudience: targetAudience ?? "AMBOS",
      active: active ?? true,
    },
  });
  res.json({ ad });
});

adminRouter.put("/ads/:id", requireAuth("ADMIN"), async (req: AuthedRequest, res) => {
  const { title, bodyText, imageUrl, targetAudience, active } = req.body as {
    title?: string;
    bodyText?: string;
    imageUrl?: string | null;
    targetAudience?: "PASAJERO" | "CONDUCTOR" | "AMBOS";
    active?: boolean;
  };
  const ad = await prisma.adCampaign.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(bodyText !== undefined ? { bodyText } : {}),
      ...(imageUrl !== undefined ? { imageUrl } : {}),
      ...(targetAudience !== undefined ? { targetAudience } : {}),
      ...(active !== undefined ? { active } : {}),
    },
  });
  res.json({ ad });
});

adminRouter.delete("/ads/:id", requireAuth("ADMIN"), async (req: AuthedRequest, res) => {
  await prisma.adCampaign.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// Aggregated view of every non-fare revenue/cost stream from the business
// model, computed from real rows (not placeholders) for the admin dashboard.
adminRouter.get("/business/overview", requireAuth("ADMIN", "DISPATCHER"), async (_req, res) => {
  const [config, completedTrips, cancelledTrips, vipDrivers, bonuses, ads] = await Promise.all([
    getPlatformConfig(),
    prisma.trip.findMany({ where: { status: "COMPLETED" }, select: { platformFeeClp: true, fareGrossClp: true } }),
    prisma.trip.findMany({
      where: { status: "CANCELLED" },
      select: { cancelledBy: true, cancellationFeeClp: true },
    }),
    prisma.driver.count({ where: { isVip: true } }),
    prisma.driverWeeklyBonus.findMany({ select: { bonusClp: true } }),
    prisma.adCampaign.findMany(),
  ]);

  const commissionRevenueClp = completedTrips.reduce((acc, t) => acc + t.platformFeeClp, 0);
  const gmvClp = completedTrips.reduce((acc, t) => acc + t.fareGrossClp, 0);

  const cancellationFeeRevenueClp = cancelledTrips.reduce((acc, t) => acc + t.cancellationFeeClp, 0);
  const cancelledWithFeeCount = cancelledTrips.filter((t) => t.cancellationFeeClp > 0).length;
  const cancellationByParty = {
    passenger: cancelledTrips.filter((t) => t.cancelledBy === "PASSENGER" && t.cancellationFeeClp > 0).length,
    driver: cancelledTrips.filter((t) => t.cancelledBy === "DRIVER" && t.cancellationFeeClp > 0).length,
  };

  const weeklyBonusPayoutsClp = bonuses.reduce((acc, b) => acc + b.bonusClp, 0);

  res.json({
    commission: {
      commissionPct: Number(config.commissionPct),
      driverNetPct: 100 - Number(config.commissionPct),
      minPct: COMMISSION_PCT_MIN,
      maxPct: COMMISSION_PCT_MAX,
      revenueClp: commissionRevenueClp,
      gmvClp,
    },
    cancellations: {
      feePassengerClp: config.cancellationFeePassengerClp,
      feeDriverClp: config.cancellationFeeDriverClp,
      revenueClp: cancellationFeeRevenueClp,
      chargedCount: cancelledWithFeeCount,
      byParty: cancellationByParty,
    },
    vip: {
      monthlyFeeClp: config.vipMonthlyFeeClp,
      vipDriverCount: vipDrivers,
      projectedMonthlyRevenueClp: vipDrivers * config.vipMonthlyFeeClp,
    },
    weeklyBonus: {
      tripThreshold: config.weeklyBonusTripThreshold,
      amountClp: config.weeklyBonusAmountClp,
      totalPaidClp: weeklyBonusPayoutsClp,
      grantCount: bonuses.length,
    },
    ads: {
      totalCount: ads.length,
      activeCount: ads.filter((a) => a.active).length,
    },
  });
});
