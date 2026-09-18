import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../lib/auth";
import { getIo } from "../ws/socket";

export const driverRouter = Router();

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
  res.json({ tripId: updated.id, status: updated.status, driverNetClp: trip.driverNetClp });
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

driverRouter.get("/wallet", requireAuth("DRIVER"), async (req: AuthedRequest, res) => {
  const driver = await getDriverOrFail(req, res);
  if (!driver) return;
  const payouts = await prisma.payout.findMany({
    where: { driverId: driver.id },
    orderBy: { executedAt: "desc" },
    take: 20,
  });
  const trips = await prisma.trip.count({ where: { driverId: driver.id, status: "COMPLETED" } });
  res.json({ walletBalanceClp: driver.walletBalanceClp, payouts, completedTrips: trips });
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
