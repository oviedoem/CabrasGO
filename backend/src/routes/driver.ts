import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../lib/auth";
import { getIo } from "../ws/socket";
import { getPlatformConfig } from "../lib/platformConfig";
import { checkAndGrantWeeklyBonus } from "../lib/weeklyBonus";

export const driverRouter = Router();

driverRouter.get("/ads", requireAuth("DRIVER"), async (_req, res) => {
  const ads = await prisma.adCampaign.findMany({
    where: { active: true, OR: [{ targetAudience: "CONDUCTOR" }, { targetAudience: "AMBOS" }] },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ads });
});

async function getDriverOrFail(req: AuthedRequest, res: any) {
  const driverId = req.auth!.driverId;
  if (!driverId) {
    res.status(403).json({ error: "Este usuario no tiene perfil de conductor" });
    return null;
  }
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, include: { user: true } });
  if (!driver) {
    res.status(404).json({ error: "Conductor no encontrado" });
    return null;
  }
  return driver;
}

driverRouter.get("/me", requireAuth("DRIVER"), async (req: AuthedRequest, res) => {
  const driver = await getDriverOrFail(req, res);
  if (!driver) return;
  res.json({
    id: driver.id,
    name: `${driver.user.firstName} ${driver.user.lastName}`,
    plate: driver.vehiclePlate,
    model: driver.vehicleModel,
    category: driver.vehicleCategory,
    has4x4: driver.has4x4,
    operationalStatus: driver.operationalStatus,
    walletBalanceClp: driver.walletBalanceClp,
    rating: Number(driver.user.ratingAvg),
    totalTrips: driver.user.totalTrips,
    lat: driver.currentLatitude ? Number(driver.currentLatitude) : null,
    lng: driver.currentLongitude ? Number(driver.currentLongitude) : null,
    isVip: driver.isVip,
  });
});

driverRouter.post("/status/toggle", requireAuth("DRIVER"), async (req: AuthedRequest, res) => {
  const { status, lat, lng, batteryPct } = req.body as {
    status: "AVAILABLE" | "OFFLINE";
    lat?: number;
    lng?: number;
    batteryPct?: number;
  };
  const driver = await getDriverOrFail(req, res);
  if (!driver) return;

  const updated = await prisma.driver.update({
    where: { id: driver.id },
    data: {
      operationalStatus: status,
      ...(lat !== undefined ? { currentLatitude: lat } : {}),
      ...(lng !== undefined ? { currentLongitude: lng } : {}),
      ...(batteryPct !== undefined ? { batteryPct } : {}),
      lastPingAt: new Date(),
    },
  });
  res.json({ operationalStatus: updated.operationalStatus });
});

driverRouter.post("/trips/:id/accept", requireAuth("DRIVER"), async (req: AuthedRequest, res) => {
  const driver = await getDriverOrFail(req, res);
  if (!driver) return;

  const trip = await prisma.trip.findUnique({ where: { id: req.params.id } });
  if (!trip) return res.status(404).json({ error: "Viaje no encontrado" });
  if (trip.status !== "DISPATCHING") {
    return res.status(409).json({ error: "El viaje ya no está disponible" });
  }

  const updated = await prisma.trip.update({
    where: { id: trip.id },
    data: { status: "ACCEPTED", driverId: driver.id, acceptedAt: new Date() },
  });
  await prisma.driver.update({
    where: { id: driver.id },
    data: { operationalStatus: "EN_ROUTE_PICKUP" },
  });

  const io = getIo();
  io.to(`trip_${trip.id}`).emit("trip:status", { tripId: trip.id, status: "ACCEPTED", driverId: driver.id });

  res.json({ tripId: updated.id, status: updated.status, pin: updated.pinVerification });
});

driverRouter.post("/trips/:id/decline", requireAuth("DRIVER"), async (req: AuthedRequest, res) => {
  // No state change needed: the trip stays DISPATCHING and the 15s cascade
  // (see passenger.ts dispatchTrip) will offer it to the next nearest driver.
  res.json({ ok: true });
});

// Cancellation penalty (point 3): a driver cancelling after having already
// accepted the trip is charged a penalty (deducted from wallet if they have
// balance, otherwise recorded as owed — kept simple as a straight deduction
// clamped at 0). No compensation flows to the driver in this case, unlike a
// passenger cancellation (see passenger.ts).
driverRouter.post("/trips/:id/cancel", requireAuth("DRIVER"), async (req: AuthedRequest, res) => {
  const driver = await getDriverOrFail(req, res);
  if (!driver) return;
  const trip = await prisma.trip.findUnique({ where: { id: req.params.id } });
  if (!trip) return res.status(404).json({ error: "Viaje no encontrado" });
  if (trip.driverId !== driver.id) return res.status(403).json({ error: "No autorizado" });
  if (trip.status === "COMPLETED" || trip.status === "CANCELLED") {
    return res.status(409).json({ error: "El viaje ya finalizó" });
  }

  const config = await getPlatformConfig();
  const cancellationFeeClp = config.cancellationFeeDriverClp;

  const updated = await prisma.trip.update({
    where: { id: trip.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: "DRIVER", cancellationFeeClp },
  });
  await prisma.driver.update({
    where: { id: driver.id },
    data: {
      operationalStatus: "AVAILABLE",
      walletBalanceClp: { decrement: Math.min(cancellationFeeClp, driver.walletBalanceClp) },
    },
  });

  getIo().to(`trip_${trip.id}`).emit("trip:status", { tripId: trip.id, status: "CANCELLED", cancellationFeeClp });
  res.json({ tripId: updated.id, status: updated.status, cancellationFeeClp });
});

driverRouter.post("/trips/:id/verify-pin", requireAuth("DRIVER"), async (req: AuthedRequest, res) => {
  const { pinEntered } = req.body as { pinEntered: string };
  const trip = await prisma.trip.findUnique({ where: { id: req.params.id } });
  if (!trip) return res.status(404).json({ error: "Viaje no encontrado" });
  if (trip.pinVerification !== pinEntered) {
    return res.status(400).json({ error: "PIN incorrecto" });
  }
  const updated = await prisma.trip.update({
    where: { id: trip.id },
    data: { status: "IN_PROGRESS", startedAt: new Date() },
  });
  if (trip.driverId) {
    await prisma.driver.update({ where: { id: trip.driverId }, data: { operationalStatus: "ON_TRIP" } });
  }
  getIo().to(`trip_${trip.id}`).emit("trip:status", { tripId: trip.id, status: "IN_PROGRESS" });
  res.json({ tripId: updated.id, status: updated.status });
});

driverRouter.post("/trips/:id/complete", requireAuth("DRIVER"), async (req: AuthedRequest, res) => {
  const trip = await prisma.trip.findUnique({ where: { id: req.params.id } });
  if (!trip || !trip.driverId) return res.status(404).json({ error: "Viaje no encontrado" });

  const updated = await prisma.trip.update({
    where: { id: trip.id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  await prisma.driver.update({
    where: { id: trip.driverId },
    data: {
      operationalStatus: "AVAILABLE",
      walletBalanceClp: { increment: trip.driverNetClp },
    },
  });
  getIo().to(`trip_${trip.id}`).emit("trip:status", { tripId: trip.id, status: "COMPLETED" });

  const weeklyBonusGrantedClp = await checkAndGrantWeeklyBonus(trip.driverId);

  res.json({
    tripId: updated.id,
    status: updated.status,
    driverNetClp: trip.driverNetClp,
    weeklyBonusGrantedClp,
  });
});

driverRouter.get("/trips/active", requireAuth("DRIVER"), async (req: AuthedRequest, res) => {
  const driver = await getDriverOrFail(req, res);
  if (!driver) return;
  const trip = await prisma.trip.findFirst({
    where: { driverId: driver.id, status: { in: ["ACCEPTED", "DRIVER_ARRIVED", "IN_PROGRESS"] } },
    include: { passenger: true },
  });
  res.json({ trip });
});

driverRouter.get("/trips/history", requireAuth("DRIVER"), async (req: AuthedRequest, res) => {
  const driver = await getDriverOrFail(req, res);
  if (!driver) return;
  const trips = await prisma.trip.findMany({
    where: { driverId: driver.id, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    take: 30,
  });
  res.json({ trips });
});

// Wallet earnings breakdown (point 2, "fuentes de ingreso adicionales del
// conductor"): the fare-split base is separated from surge/dynamic-pricing
// income, weekly goal bonuses and passenger tips so each stream is clearly
// attributed rather than folded into one flat balance number.
driverRouter.get("/wallet", requireAuth("DRIVER"), async (req: AuthedRequest, res) => {
  const driver = await getDriverOrFail(req, res);
  if (!driver) return;

  const [payouts, completedTrips, cancelledTrips, bonuses, ratings] = await Promise.all([
    prisma.payout.findMany({ where: { driverId: driver.id }, orderBy: { executedAt: "desc" }, take: 20 }),
    prisma.trip.findMany({
      where: { driverId: driver.id, status: "COMPLETED" },
      select: { driverNetClp: true, dynamicMultiplier: true },
    }),
    prisma.trip.findMany({
      where: { driverId: driver.id, status: "CANCELLED", cancellationFeeClp: { gt: 0 } },
      select: { cancelledBy: true, cancellationFeeClp: true },
    }),
    prisma.driverWeeklyBonus.findMany({ where: { driverId: driver.id }, orderBy: { weekStart: "desc" }, take: 12 }),
    prisma.rating.findMany({ where: { toUserId: driver.userId }, select: { tipClp: true } }),
  ]);

  const fareBaseClp = completedTrips.reduce((acc, t) => acc + t.driverNetClp, 0);
  const surgeBonusClp = completedTrips.reduce((acc, t) => {
    const mult = Number(t.dynamicMultiplier);
    if (mult <= 1) return acc;
    return acc + Math.round(t.driverNetClp - t.driverNetClp / mult);
  }, 0);
  const tipsClp = ratings.reduce((acc, r) => acc + r.tipClp, 0);
  const weeklyBonusClp = bonuses.reduce((acc, b) => acc + b.bonusClp, 0);
  const cancellationCompensationClp = cancelledTrips
    .filter((t) => t.cancelledBy === "PASSENGER")
    .reduce((acc, t) => acc + t.cancellationFeeClp, 0);
  const cancellationPenaltiesClp = cancelledTrips
    .filter((t) => t.cancelledBy === "DRIVER")
    .reduce((acc, t) => acc + t.cancellationFeeClp, 0);

  res.json({
    walletBalanceClp: driver.walletBalanceClp,
    payouts,
    completedTrips: completedTrips.length,
    isVip: driver.isVip,
    earningsBreakdown: {
      fareBaseClp: fareBaseClp - surgeBonusClp,
      surgeBonusClp,
      tipsClp,
      weeklyBonusClp,
      cancellationCompensationClp,
      cancellationPenaltiesClp,
    },
    weeklyBonuses: bonuses,
  });
});

driverRouter.post("/wallet/payout-request", requireAuth("DRIVER"), async (req: AuthedRequest, res) => {
  const { amountClp, targetAccount } = req.body as { amountClp: number; targetAccount?: string };
  const driver = await getDriverOrFail(req, res);
  if (!driver) return;

  if (!amountClp || amountClp <= 0 || amountClp > driver.walletBalanceClp) {
    return res.status(400).json({ error: "Monto inválido o excede el saldo disponible" });
  }

  // Mocked BancoEstado TEF batch transfer (BANCOESTADO_TEF_API_KEY sandbox)
  const tefRefCode = `PAGO-PROV-${Date.now().toString(36).toUpperCase()}`;
  const payout = await prisma.payout.create({
    data: {
      driverId: driver.id,
      amountClp,
      bankTarget: targetAccount ?? "CuentaRUT BancoEstado",
      tefRefCode,
      status: "PROCESSED",
    },
  });
  await prisma.driver.update({
    where: { id: driver.id },
    data: { walletBalanceClp: { decrement: amountClp } },
  });
  res.json({ payoutId: payout.id, tefRefCode, status: payout.status });
});
