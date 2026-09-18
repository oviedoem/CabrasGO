import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { prisma } from "../lib/prisma";

let io: Server | null = null;

export function initSockets(server: HttpServer): Server {
  io = new Server(server, {
    cors: { origin: "*" },
    perMessageDeflate: true, // brotli/gzip-style compression per spec section 5
  });

  io.on("connection", (socket: Socket) => {
    socket.on("join:driver", (driverId: string) => {
      socket.join(`driver_${driverId}`);
    });
    socket.on("join:trip", (tripId: string) => {
      socket.join(`trip_${tripId}`);
    });
    socket.on("join:admin", () => {
      socket.join("admin_room");
    });
  });

  startTelemetryStream(io);
  startSimulatedMovement(io);

  return io;
}

export function getIo(): Server {
  if (!io) throw new Error("Sockets not initialized");
  return io;
}

// ---- Canal de Telemetría GPS Conductor (driver:telemetry:stream), cada 3s ----
function startTelemetryStream(ioInstance: Server) {
  setInterval(async () => {
    const drivers = await prisma.driver.findMany({
      where: { operationalStatus: { in: ["AVAILABLE", "EN_ROUTE_PICKUP", "ON_TRIP"] } },
      select: {
        id: true,
        currentLatitude: true,
        currentLongitude: true,
        headingDeg: true,
        speedKmh: true,
        batteryPct: true,
        operationalStatus: true,
      },
    });
    const payload = drivers.map((d) => ({
      driverId: d.id,
      lat: d.currentLatitude ? Number(d.currentLatitude) : null,
      lng: d.currentLongitude ? Number(d.currentLongitude) : null,
      heading: d.headingDeg ? Number(d.headingDeg) : 0,
      speedKmh: d.speedKmh ? Number(d.speedKmh) : 0,
      batteryLevel: d.batteryPct ?? 100,
      status: d.operationalStatus,
    }));
    ioInstance.emit("driver:telemetry:stream", payload);
  }, 3000);
}

// ---- Server-side simulated driver movement along the active trip's route ----
// Since there is no real GPS in this environment, drivers assigned to a trip
// (EN_ROUTE_PICKUP or ON_TRIP) are nudged along a straight line from their
// current position toward the pickup or destination every tick, and the
// updated position is persisted + broadcast, so the passenger's live map
// genuinely reflects backend state.
function startSimulatedMovement(ioInstance: Server) {
  setInterval(async () => {
    const activeTrips = await prisma.trip.findMany({
      where: { status: { in: ["ACCEPTED", "DRIVER_ARRIVED", "IN_PROGRESS"] } },
      include: { driver: true },
    });

    for (const trip of activeTrips) {
      if (!trip.driver) continue;
      const target =
        trip.status === "IN_PROGRESS"
          ? { lat: Number(trip.destLat), lng: Number(trip.destLng) }
          : { lat: Number(trip.originLat), lng: Number(trip.originLng) };

      const curLat = Number(trip.driver.currentLatitude ?? target.lat);
      const curLng = Number(trip.driver.currentLongitude ?? target.lng);

      const dLat = target.lat - curLat;
      const dLng = target.lng - curLng;
      const dist = Math.sqrt(dLat * dLat + dLng * dLng);

      const STEP = 0.0009; // ~ moves a fraction of the remaining gap per tick
      let nextLat = curLat;
      let nextLng = curLng;
      let arrived = false;

      if (dist < STEP || dist === 0) {
        nextLat = target.lat;
        nextLng = target.lng;
        arrived = true;
      } else {
        const ratio = STEP / dist;
        nextLat = curLat + dLat * ratio;
        nextLng = curLng + dLng * ratio;
      }

      const heading = (Math.atan2(dLng, dLat) * 180) / Math.PI;

      await prisma.driver.update({
        where: { id: trip.driver.id },
        data: {
          currentLatitude: nextLat,
          currentLongitude: nextLng,
          headingDeg: heading,
          speedKmh: arrived ? 0 : 28 + Math.random() * 10,
          lastPingAt: new Date(),
        },
      });

      await prisma.trip.update({
        where: { id: trip.id },
        data: { liveLat: nextLat, liveLng: nextLng },
      });

      ioInstance.to(`trip_${trip.id}`).emit("trip:live_position", {
        tripId: trip.id,
        lat: nextLat,
        lng: nextLng,
        heading,
        status: trip.status,
        arrived,
      });

      if (arrived && trip.status === "ACCEPTED") {
        await prisma.trip.update({
          where: { id: trip.id },
          data: { status: "DRIVER_ARRIVED", arrivedAt: new Date() },
        });
        ioInstance.to(`trip_${trip.id}`).emit("trip:status", {
          tripId: trip.id,
          status: "DRIVER_ARRIVED",
        });
      }
    }
  }, 1500);
}
