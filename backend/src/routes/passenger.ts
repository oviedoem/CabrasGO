import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../lib/auth";
import { buildQuote, resolveGeofence, avgFuelPriceClp } from "../lib/quote";
import { splitFare, CATEGORY_MULTIPLIER, computeFare } from "../lib/fare";
import { haversineKm } from "../lib/geofence";
import { getIo } from "../ws/socket";
import { LANDMARKS, QUICK_ACCESS_CODES } from "../lib/landmarks";

export const passengerRouter = Router();

passengerRouter.get("/landmarks", (_req, res) => {
  res.json({
    landmarks: LANDMARKS,
    quickAccess: LANDMARKS.filter((l) => QUICK_ACCESS_CODES.includes(l.code)),
    defaultOrigin: LANDMARKS[0],
  });
});

passengerRouter.post("/quote", async (req, res) => {
  const { origin, destination } = req.body as {
    origin: { lat: number; lng: number; address?: string };
    destination: { lat: number; lng: number; address?: string };
  };
  if (!origin || !destination) {
    return res.status(400).json({ error: "origin y destination son requeridos" });
  }
  const quote = await buildQuote({ origin, destination });
  res.json(quote);
});

passengerRouter.post("/trips/request", requireAuth("PASSENGER"), async (req: AuthedRequest, res) => {
  const passengerId = req.auth!.userId;
  const { origin, destination, category, paymentMethod } = req.body as {
    origin: { lat: number; lng: number; address: string };
    destination: { lat: number; lng: number; address: string };
    category: "STANDARD_SEDAN" | "RURAL_4X4_XL";
    paymentMethod: "WEBPAY_ONECLICK" | "CUENTARUT_BANCOESTADO" | "CASH";
  };

  const distanceKmTotal = haversineKm(origin, destination);
  const zone = (await resolveGeofence(destination)) ?? (await resolveGeofence(origin));
  const ruralZones = ["LLALLAUQUEN", "EL_MANZANO", "MARINA_GOLF_RAPEL"];
  const dirtFraction = zone && ruralZones.includes(zone.code) ? 0.35 : 0.08;
  const distanceKmDirt = Math.round(distanceKmTotal * dirtFraction * 100) / 100;
  const distanceKmPaved = Math.round((distanceKmTotal - distanceKmDirt) * 100) / 100;
  const dynamicMultiplier = zone ? Number(zone.dynamicMultiplier) : 1.0;
  const fuelPrice = await avgFuelPriceClp();

  const fare = computeFare({
    distanceKmPaved,
    distanceKmDirt,
    dynamicMultiplier,
    avgFuelPriceClp: fuelPrice,
  });
  const catMultiplier = CATEGORY_MULTIPLIER[category] ?? 1.0;
  const fareGrossClp = Math.round(fare.totalFareClp * catMultiplier);
  const { driverNetClp, platformFeeClp } = splitFare(fareGrossClp);

  const pin = String(Math.floor(1000 + Math.random() * 9000));

  const trip = await prisma.trip.create({
    data: {
      passengerId,
      status: "DISPATCHING",
      category,
      pinVerification: pin,
      originAddress: origin.address ?? "Origen",
      originLat: origin.lat,
      originLng: origin.lng,
      destAddress: destination.address ?? "Destino",
      destLat: destination.lat,
      destLng: destination.lng,
      distanceKmTotal,
      distanceKmPaved,
      distanceKmDirt,
      geofenceZoneCode: zone?.code ?? null,
      dynamicMultiplier,
      fuelFactor: fare.fuelFactor,
      fareGrossClp,
      driverNetClp,
      platformFeeClp,
      paymentMethod: paymentMethod ?? "WEBPAY_ONECLICK",
      paymentStatus: "PENDING",
    },
  });

  dispatchTrip(trip.id).catch((e) => console.error("dispatch error", e));

  res.json({ tripId: trip.id, status: trip.status, pin: trip.pinVerification, fareGrossClp, driverNetClp });
});

// ---- 15s dispatch cascade: offer to nearest available driver, requeue on timeout ----
async function dispatchTrip(tripId: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip || trip.status !== "DISPATCHING") return;

  const candidates = await prisma.driver.findMany({
    where: {
      operationalStatus: "AVAILABLE",
      isKycVerified: true,
      ...(trip.category === "RURAL_4X4_XL" ? { has4x4: true } : {}),
    },
  });
  if (!candidates.length) return; // no drivers available; stays DISPATCHING

  const withDistance = candidates
    .map((d) => ({
      driver: d,
      distanceKm: haversineKm(
        { lat: Number(trip.originLat), lng: Number(trip.originLng) },
        { lat: Number(d.currentLatitude ?? trip.originLat), lng: Number(d.currentLongitude ?? trip.originLng) }
      ),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const nearest = withDistance[0];
  const io = getIo();

  const zone = trip.geofenceZoneCode;
  io.to(`driver_${nearest.driver.id}`).emit("trip:dispatch:offer", {
    tripId: trip.id,
    expiresInSecs: 15,
    netEarningsClp: trip.driverNetClp,
    grossFareClp: trip.fareGrossClp,
    pickupAddress: trip.originAddress,
    destAddress: trip.destAddress,
    terrainType: Number(trip.distanceKmDirt) > 0.5 ? `RIPIO_${trip.distanceKmDirt}KM` : "ASFALTO",
    pickupDistanceKm: Math.round(nearest.distanceKm * 10) / 10,
    requires4x4: trip.category === "RURAL_4X4_XL",
    geofenceZone: zone,
  });

  setTimeout(async () => {
    const fresh = await prisma.trip.findUnique({ where: { id: tripId } });
    if (fresh && fresh.status === "DISPATCHING") {
      // offer expired unanswered: retry against remaining candidates (excluding this driver)
      const remaining = withDistance.filter((c) => c.driver.id !== nearest.driver.id);
      if (remaining.length) {
        dispatchTrip(tripId).catch(() => {});
      }
    }
  }, 15000);
}

passengerRouter.get("/trips/:id/live", requireAuth("PASSENGER"), async (req: AuthedRequest, res) => {
  const trip = await prisma.trip.findUnique({
    where: { id: req.params.id },
    include: { driver: { include: { user: true } } },
  });
  if (!trip) return res.status(404).json({ error: "Viaje no encontrado" });

  res.json({
    tripId: trip.id,
    status: trip.status,
    pin: trip.pinVerification,
    fareGrossClp: trip.fareGrossClp,
    driverNetClp: trip.driverNetClp,
    paymentMethod: trip.paymentMethod,
    paymentStatus: trip.paymentStatus,
    origin: { lat: Number(trip.originLat), lng: Number(trip.originLng), address: trip.originAddress },
    destination: { lat: Number(trip.destLat), lng: Number(trip.destLng), address: trip.destAddress },
    live: trip.liveLat && trip.liveLng ? { lat: Number(trip.liveLat), lng: Number(trip.liveLng) } : null,
    driver: trip.driver
      ? {
          id: trip.driver.id,
          name: `${trip.driver.user.firstName} ${trip.driver.user.lastName}`,
          plate: trip.driver.vehiclePlate,
          model: trip.driver.vehicleModel,
          rating: Number(trip.driver.user.ratingAvg),
          phone: trip.driver.user.phone,
        }
      : null,
    sosPhone: "133",
  });
});

passengerRouter.post("/trips/:id/pay", requireAuth("PASSENGER"), async (req: AuthedRequest, res) => {
  const { method } = req.body as { method: "WEBPAY_ONECLICK" | "CUENTARUT_BANCOESTADO" | "CASH" };
  const trip = await prisma.trip.findUnique({ where: { id: req.params.id } });
  if (!trip) return res.status(404).json({ error: "Viaje no encontrado" });

  // Mocked payment gateway integration (Transbank Webpay / BancoEstado TEF sandbox)
  const gatewayRef = `${method === "CASH" ? "CASH" : "SBX"}-${Date.now().toString(36).toUpperCase()}`;
  const updated = await prisma.trip.update({
    where: { id: trip.id },
    data: {
      paymentMethod: method,
      paymentStatus: method === "CASH" ? "AUTHORIZED" : "CAPTURED",
      paymentGatewayRef: gatewayRef,
    },
  });
  res.json({ tripId: updated.id, paymentStatus: updated.paymentStatus, paymentGatewayRef: gatewayRef });
});

passengerRouter.post("/trips/:id/rate", requireAuth("PASSENGER"), async (req: AuthedRequest, res) => {
  const { score, feedbackTags, tipClp } = req.body as {
    score: number;
    feedbackTags?: string[];
    tipClp?: number;
  };
  const trip = await prisma.trip.findUnique({ where: { id: req.params.id } });
  if (!trip || !trip.driverId) return res.status(404).json({ error: "Viaje no encontrado" });

  const driver = await prisma.driver.findUnique({ where: { id: trip.driverId }, include: { user: true } });
  if (!driver) return res.status(404).json({ error: "Conductor no encontrado" });

  const rating = await prisma.rating.create({
    data: {
      tripId: trip.id,
      fromUserId: req.auth!.userId,
      toUserId: driver.userId,
      score,
      feedbackTagsJson: JSON.stringify(feedbackTags ?? []),
      tipClp: tipClp ?? 0,
    },
  });

  if (tipClp && tipClp > 0) {
    await prisma.driver.update({
      where: { id: driver.id },
      data: { walletBalanceClp: { increment: tipClp } },
    });
  }

  const newTotal = driver.user.totalTrips + 1;
  const newAvg =
    (Number(driver.user.ratingAvg) * driver.user.totalTrips + score) / newTotal;
  await prisma.user.update({
    where: { id: driver.userId },
    data: { ratingAvg: Math.round(newAvg * 100) / 100, totalTrips: newTotal },
  });

  res.json({ ratingId: rating.id });
});

passengerRouter.get("/trips/history", requireAuth("PASSENGER"), async (req: AuthedRequest, res) => {
  const trips = await prisma.trip.findMany({
    where: { passengerId: req.auth!.userId },
    orderBy: { requestedAt: "desc" },
    take: 20,
    include: { driver: { include: { user: true } }, rating: true },
  });
  res.json({ trips });
});
