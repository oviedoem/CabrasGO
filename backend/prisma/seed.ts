import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { makeRut } from "../src/lib/chile";

const prisma = new PrismaClient();

const poly = (pts: [number, number][]) => JSON.stringify(pts);

async function main() {
  console.log("Seeding CabrasGo demo database...");
  console.log(
    "NOTA: los usuarios/conductores/pasajeros sembrados son CUENTAS DEMO (seed/test), " +
      "no personas reales. Usan RUTs con dígito verificador válido (módulo 11) sólo " +
      "para respetar el formato chileno; los datos de geocercas, coordenadas GPS y " +
      "precios de combustible sí corresponden a la especificación real del proyecto."
  );

  await prisma.rating.deleteMany();
  await prisma.payout.deleteMany();
  await prisma.driverWeeklyBonus.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.user.deleteMany();
  await prisma.geofenceZone.deleteMany();
  await prisma.fuelBenchmark.deleteMany();
  await prisma.adCampaign.deleteMany();
  await prisma.platformConfig.deleteMany();

  // ---- Platform business/commission config (point 3) ----
  // Starting default: 15% commission / 85% driver net — the top of the
  // driver-friendly end of the allowed 70%-85% net range.
  await prisma.platformConfig.create({
    data: {
      commissionPct: 15.0,
      cancellationFeePassengerClp: 2000,
      cancellationFeeDriverClp: 3000,
      weeklyBonusTripThreshold: 20,
      weeklyBonusAmountClp: 15000,
      vipMonthlyFeeClp: 12000,
    },
  });

  // ---- Ad campaigns (in-app advertising, point 3) ----
  await prisma.adCampaign.createMany({
    data: [
      {
        title: "Copec Las Cabras Centro",
        bodyText: "10% de descuento en lavado de auto mostrando tu viaje CabrasGo completado.",
        targetAudience: "PASAJERO",
        active: true,
      },
      {
        title: "Feria Costumbrista de Peumo",
        bodyText: "Este fin de semana en la Plaza de Peumo — viaja seguro con CabrasGo.",
        targetAudience: "PASAJERO",
        active: true,
      },
      {
        title: "Seguro SOAP El Manzano",
        bodyText: "Renueva tu SOAP con 15% de descuento para conductores CabrasGo verificados.",
        targetAudience: "CONDUCTOR",
        active: true,
      },
      {
        title: "Promoción fin de temporada",
        bodyText: "Campaña de verano ya finalizada.",
        targetAudience: "AMBOS",
        active: false,
      },
    ],
  });

  // ---- Geofence zones (4 comunales, per manual técnico + spec unificada) ----
  await prisma.geofenceZone.createMany({
    data: [
      {
        code: "LAS_CABRAS_CENTRO",
        name: "Las Cabras Centro",
        isHighDemand: true,
        dynamicMultiplier: 1.0,
        require4x4: false,
        dirtRoadSurchargeClp: 0,
        boundaryPolygonJson: poly([
          [-34.28, -71.322],
          [-34.28, -71.292],
          [-34.303, -71.292],
          [-34.303, -71.322],
        ]),
      },
      {
        code: "MARINA_GOLF_RAPEL",
        name: "Marina Golf Rapel (Bahía)",
        isHighDemand: true,
        dynamicMultiplier: 1.35,
        require4x4: false,
        dirtRoadSurchargeClp: 300,
        boundaryPolygonJson: poly([
          [-34.238, -71.443],
          [-34.238, -71.42],
          [-34.262, -71.42],
          [-34.262, -71.443],
        ]),
      },
      {
        code: "LLALLAUQUEN",
        name: "Llallauquén",
        isHighDemand: true,
        dynamicMultiplier: 1.35,
        require4x4: true,
        dirtRoadSurchargeClp: 500,
        boundaryPolygonJson: poly([
          [-34.253, -71.47],
          [-34.253, -71.43],
          [-34.287, -71.43],
          [-34.287, -71.47],
        ]),
      },
      {
        code: "EL_MANZANO",
        name: "El Manzano (Ribera Lago Rapel)",
        isHighDemand: false,
        dynamicMultiplier: 1.15,
        require4x4: true,
        dirtRoadSurchargeClp: 400,
        boundaryPolygonJson: poly([
          [-34.213, -71.422],
          [-34.213, -71.39],
          [-34.237, -71.39],
          [-34.237, -71.422],
        ]),
      },
    ],
  });

  // ---- Fuel benchmarks (real named servicentros, exact seed prices) ----
  await prisma.fuelBenchmark.createMany({
    data: [
      {
        stationName: "Copec Las Cabras Centro",
        stationCode: "COPEC_LAS_CABRAS",
        stationAddress: "Av. Carlos Valdovinos 450, Las Cabras",
        comuna: "Las Cabras",
        gasoline93Clp: 1294,
        dieselClp: 1042,
        sourceAgency: "CNE_ENAP",
      },
      {
        stationName: "Shell Cruce Las Cabras",
        stationCode: "SHELL_CRUCE",
        stationAddress: "Ruta H-66 km 28, Las Cabras",
        comuna: "Las Cabras",
        gasoline93Clp: 1298,
        dieselClp: 1046,
        sourceAgency: "CNE_ENAP",
      },
      {
        stationName: "Petrobras El Manzano",
        stationCode: "PETROBRAS_EL_MANZANO",
        stationAddress: "Camino Ribereño s/n, El Manzano, Las Cabras",
        comuna: "Las Cabras",
        gasoline93Clp: 1312,
        dieselClp: 1060,
        sourceAgency: "CNE_ENAP",
      },
    ],
  });

  const passwordHash = await bcrypt.hash("cabrasgo2025", 10);

  // ---- Admin ----
  await prisma.user.create({
    data: {
      rut: makeRut(11222333),
      firstName: "Marcela",
      lastName: "Fuentes",
      email: "admin@cabrasgo.cl",
      phone: "+56987654321",
      passwordHash,
      role: "ADMIN",
    },
  });

  // ---- Passengers ----
  const passengerSeeds = [
    { rut: 15987654, firstName: "Camila", lastName: "Reyes", email: "camila.reyes@example.cl", phone: "+56911112222" },
    { rut: 17456123, firstName: "Benjamín", lastName: "Soto", email: "benjamin.soto@example.cl", phone: "+56922223333" },
    { rut: 12876543, firstName: "Francisca", lastName: "Muñoz", email: "francisca.munoz@example.cl", phone: "+56933334444" },
    { rut: 19345678, firstName: "Alejandro", lastName: "Oviedo", email: "alejandrog45@gmail.com", phone: "+56944445555" },
  ];
  const passengers = [];
  for (const p of passengerSeeds) {
    passengers.push(
      await prisma.user.create({
        data: {
          rut: makeRut(p.rut),
          firstName: p.firstName,
          lastName: p.lastName,
          email: p.email,
          phone: p.phone,
          passwordHash,
          role: "PASSENGER",
          ratingAvg: 4.8,
          totalTrips: Math.floor(Math.random() * 20) + 1,
        },
      })
    );
  }

  // ---- Drivers ----
  const driverSeeds = [
    {
      rut: 14567890,
      firstName: "Pedro",
      lastName: "Álvarez",
      email: "pedro.alvarez@cabrasgo.cl",
      phone: "+56955556666",
      plate: "LKPX84",
      model: "Toyota RAV4 2022",
      category: "RURAL_4X4_XL" as const,
      has4x4: true,
      lat: -34.2917,
      lng: -71.3092,
    },
    {
      rut: 16123789,
      firstName: "Ximena",
      lastName: "Contreras",
      email: "ximena.contreras@cabrasgo.cl",
      phone: "+56966667777",
      plate: "HJRT56",
      model: "Suzuki Jimny 2021",
      category: "RURAL_4X4_XL" as const,
      has4x4: true,
      lat: -34.2711,
      lng: -71.4589,
    },
    {
      rut: 13789456,
      firstName: "Rodrigo",
      lastName: "Pizarro",
      email: "rodrigo.pizarro@cabrasgo.cl",
      phone: "+56977778888",
      plate: "FGKL23",
      model: "Chevrolet Grand Vitara 2019",
      category: "RURAL_4X4_XL" as const,
      has4x4: true,
      lat: -34.2486,
      lng: -71.4312,
    },
    {
      rut: 18234567,
      firstName: "Daniela",
      lastName: "Vásquez",
      email: "daniela.vasquez@cabrasgo.cl",
      phone: "+56988889999",
      plate: "PLKM12",
      model: "Nissan Versa 2020",
      category: "STANDARD_SEDAN" as const,
      has4x4: false,
      lat: -34.288,
      lng: -71.302,
    },
    {
      rut: 12345678,
      firstName: "Osvaldo",
      lastName: "Bravo",
      email: "osvaldo.bravo@cabrasgo.cl",
      phone: "+56999990000",
      plate: "BNVC78",
      model: "Chevrolet Sail 2018",
      category: "STANDARD_SEDAN" as const,
      has4x4: false,
      lat: -34.2965,
      lng: -71.3148,
    },
  ];

  const drivers = [];
  for (const d of driverSeeds) {
    const user = await prisma.user.create({
      data: {
        rut: makeRut(d.rut),
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email,
        phone: d.phone,
        passwordHash,
        role: "DRIVER",
        ratingAvg: 4.7 + Math.random() * 0.3,
        totalTrips: Math.floor(Math.random() * 400) + 50,
      },
    });
    const driver = await prisma.driver.create({
      data: {
        userId: user.id,
        licenseNumber: `A2-${Math.floor(100000 + Math.random() * 899999)}`,
        licenseExpiry: new Date("2027-06-30"),
        soapExpiry: new Date("2026-12-31"),
        technicalReviewExp: new Date("2027-03-15"),
        isKycVerified: true,
        operationalStatus: "AVAILABLE",
        walletBalanceClp: Math.floor(Math.random() * 90000) + 10000,
        bankAccountRut: makeRut(d.rut),
        bankCode: "012",
        vehiclePlate: d.plate,
        vehicleModel: d.model,
        vehicleCategory: d.category,
        has4x4: d.has4x4,
        currentLatitude: d.lat,
        currentLongitude: d.lng,
        headingDeg: Math.floor(Math.random() * 360),
        speedKmh: 0,
        batteryPct: 70 + Math.floor(Math.random() * 30),
        lastPingAt: new Date(),
        // VIP/priority subscription (point 3): the top-rated, longest-serving
        // driver (Pedro Álvarez) is seeded as the demo's one VIP subscriber.
        isVip: d.plate === "LKPX84",
        vipSince: d.plate === "LKPX84" ? new Date() : null,
      },
    });
    drivers.push({ user, driver });
  }

  // ---- Weekly goal bonus (point 2): one driver already hit this week's
  // threshold, so the admin bonus payouts list has a real row to show. ----
  const bonusDriver = drivers[1]; // Ximena Contreras
  const weekStart = (() => {
    const d = new Date();
    const day = d.getDay();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  })();
  await prisma.driverWeeklyBonus.create({
    data: {
      driverId: bonusDriver.driver.id,
      weekStart,
      tripsCompleted: 22,
      bonusClp: 15000,
    },
  });
  await prisma.driver.update({
    where: { id: bonusDriver.driver.id },
    data: { walletBalanceClp: { increment: 15000 } },
  });

  // ---- Cancelled trip with a cancellation fee (point 3) ----
  // Passenger cancelled after the driver had already accepted (ACCEPTED ->
  // CANCELLED), so the $2.000 passenger cancellation fee applies and is
  // reflected in admin revenue.
  const cancelPassenger = passengers[2];
  const cancelDriver = drivers[3]; // Daniela Vásquez, STANDARD_SEDAN
  await prisma.trip.create({
    data: {
      passengerId: cancelPassenger.id,
      driverId: cancelDriver.driver.id,
      status: "CANCELLED",
      category: "STANDARD_SEDAN",
      pinVerification: String(Math.floor(1000 + Math.random() * 9000)),
      originAddress: "Plaza de Armas de Las Cabras",
      originLat: -34.2917,
      originLng: -71.3092,
      destAddress: "Hospital de Las Cabras",
      destLat: -34.2944,
      destLng: -71.3129,
      distanceKmTotal: 1.9,
      distanceKmPaved: 1.75,
      distanceKmDirt: 0.15,
      geofenceZoneCode: "LAS_CABRAS_CENTRO",
      dynamicMultiplier: 1.0,
      fuelFactor: 1.0,
      fareGrossClp: 2450,
      driverNetClp: 2083,
      platformFeeClp: 367,
      paymentMethod: "CASH",
      paymentStatus: "PENDING",
      requestedAt: new Date(Date.now() - 30 * 60 * 1000),
      acceptedAt: new Date(Date.now() - 28 * 60 * 1000),
      cancelledAt: new Date(Date.now() - 25 * 60 * 1000),
      cancelledBy: "PASSENGER",
      cancellationFeeClp: 2000,
    },
  });
  await prisma.driver.update({
    where: { id: cancelDriver.driver.id },
    // Driver is compensated 85% of the cancellation fee, same commission split.
    data: { walletBalanceClp: { increment: 1700 } },
  });

  console.log(
    `Seeded: 1 admin, ${passengers.length} passengers, ${drivers.length} drivers, 4 geofences, 3 fuel benchmarks, ` +
      `1 platform config (15% comisión), 4 ad campaigns, 1 driver VIP, 1 weekly bonus, 1 cancelled trip with fee.`
  );
  console.log("Demo login password for all seeded users: cabrasgo2025");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
