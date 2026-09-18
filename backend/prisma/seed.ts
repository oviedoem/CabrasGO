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
  await prisma.trip.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.user.deleteMany();
  await prisma.geofenceZone.deleteMany();
  await prisma.fuelBenchmark.deleteMany();

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
      },
    });
    drivers.push({ user, driver });
  }

  console.log(`Seeded: 1 admin, ${passengers.length} passengers, ${drivers.length} drivers, 4 geofences, 3 fuel benchmarks.`);
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
