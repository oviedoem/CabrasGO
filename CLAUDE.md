# CLAUDE.md — CabrasGo business/domain knowledge

This file is the "conocimiento del negocio" reference for CabrasGo. Keep it
up to date when the fare algorithm, region, geofences or payment methods
change.

## Purpose

CabrasGo is a ride-sharing / mobility platform serving **Las Cabras, Peumo,
San Vicente de Tagua Tagua and the Lago Rapel basin** (VI Región de
O'Higgins, Chile). It matches passengers with a small local fleet of
drivers, quoting fares with a rural-aware algorithm (paved vs dirt road,
seasonal geofence multipliers, fuel-price indexation) and handling the full
trip lifecycle, driver payouts (85%/15% split), and an admin control panel
for KPIs, geofences and KYC.

## Tech stack

- **Backend**: Node.js + TypeScript + Express + Prisma ORM + SQLite (dev
  datasource; production alternative is Postgres+PostGIS, documented in
  `backend/prisma/schema.prisma`). Socket.io for realtime channels.
  Auth: JWT (`JWT_SECRET` env var), bcrypt password hashes.
- **Frontend**: Vite + React + TypeScript + Tailwind CSS. `react-router-dom`
  for the three role areas. `socket.io-client` for realtime updates.
  `react-leaflet` + OpenStreetMap tiles for maps (no API key needed).
- **No external services required to run**: SQLite is a local file,
  payment/fuel integrations are mocked behind the spec's own API shapes.

## Directory layout

```
backend/prisma/schema.prisma   Data model (see header comment for Postgres+PostGIS swap)
backend/prisma/seed.ts         Seeds geofences, fuel benchmarks, demo users
backend/src/lib/fare.ts        Fare algorithm constants + computeFare/splitFare
backend/src/lib/geofence.ts    Point-in-polygon containment (PostGIS ST_Contains replacement)
backend/src/lib/chile.ts       RUT/patente/CLP/phone formatting + RUT check-digit validation
backend/src/lib/quote.ts       Shared quote-building logic (used by /quote and /trips/request)
backend/src/lib/landmarks.ts   The 10 validated VI Región GPS landmarks
backend/src/routes/            passenger.ts, driver.ts, admin.ts, auth.ts (REST API)
backend/src/ws/socket.ts       Socket.io: 15s dispatch cascade, telemetry, movement sim
frontend/src/pages/pasajero/   Passenger app (light mode)
frontend/src/pages/conductor/  Driver app (dark OLED mode)
frontend/src/pages/admin/      Admin control panel (desktop dashboard)
frontend/src/components/LiveMap.tsx   Leaflet/OSM map component shared by all three apps
```

## How to run / seed / test

```bash
npm run setup   # root: installs both workspaces, provisions SQLite, seeds demo data
npm run dev     # root: runs backend (:8080) + frontend (:5173) concurrently
npm run seed    # root: re-run the seed script only (wipes and reseeds all tables)
```

Backend alone: `cd backend && npm install && npm run prisma:generate && npm run prisma:push && npm run seed && npm run dev`.
Frontend alone: `cd frontend && npm install && npm run dev`.
Production build: `npm run build` (root) or per-workspace `npm run build`.

There is no dedicated automated test suite yet; verification is done by
curling the REST endpoints (`/api/v1/health`, `/api/v1/passenger/quote`,
`/api/v1/passenger/trips/request`, `/api/v1/admin/kpis/realtime`, ...) and by
building the frontend + loading each of `/`, `/pasajero`, `/conductor`,
`/admin` in a browser.

## Fare algorithm summary

```
Tarifa = [ B + (D_pav·C_pav) + (D_ripio·C_ripio) + (T_est·C_min) ] × M_estival × F_combustible
```

- `B` (bajada de bandera) = $1.200 CLP
- `C_pav` = $350 CLP/km asfalto
- `C_ripio` = $550 CLP/km ripio
- `C_min` = $120 CLP/minuto estimado (distance / ~38 km/h average rural speed)
- `M_estival` = geofence's `dynamicMultiplier` (1.0 default, 1.35 for
  Llallauquén/Marina Golf in high season, 1.15 for El Manzano)
- `F_combustible = 1 + ((avgFuelPrice − 1250) / 1250 × 0.25)`, rounded to
  `1.00` whenever `|F − 1.00| < 0.02` (damping band)
- Fuel benchmark only re-indexes when it moves > $25 CLP/L from the last
  reading (`FUEL_PRICE_SYNC_TRIGGER_CLP`)
- Category premium: `RURAL_4X4_XL` = ×1.22 over `STANDARD_SEDAN`
- Driver/platform split: 85% driver (`driverNetClp`) / 15% platform
  (`platformFeeClp`)

All constants live in `backend/src/lib/fare.ts`.

## Key domain facts

- **Región / comunas**: VI Región de O'Higgins — Las Cabras (primary),
  Peumo, San Vicente de Tagua Tagua, around the Lago Rapel basin.
- **Geofence zones** (exact codes, do not rename): `LAS_CABRAS_CENTRO`,
  `MARINA_GOLF_RAPEL`, `LLALLAUQUEN`, `EL_MANZANO`.
- **Fuel stations** (real, seeded with today's date): Copec Las Cabras
  Centro (Av. Carlos Valdovinos 450) — gasolina 93 $1.294/L, diésel
  $1.042/L; Shell Cruce Las Cabras (Ruta H-66 km 28) — $1.298 / $1.046;
  Petrobras El Manzano (Camino Ribereño s/n) — $1.312 / $1.060.
- **10 GPS landmarks** (validated, real coordinates — see
  `backend/src/lib/landmarks.ts`): Plaza de Armas de Las Cabras (default
  passenger origin), Marina Golf Rapel, El Manzano, Balneario Llallauquén,
  Hospital de Las Cabras, Cruce Las Cabras, Punta Verde, Cocalán, Cruce
  Peumo–San Vicente, Cerro Llallauquén (repetidora).
- **Payment methods**: `WEBPAY_ONECLICK` (Transbank),
  `CUENTARUT_BANCOESTADO` (BancoEstado), `CASH`.
- **RUT format**: `12.345.678-9`, módulo-11 check digit
  (`isValidRut`/`makeRut`/`formatRut` in `backend/src/lib/chile.ts`).
- **Patente format**: `LK · PX · 84`.
- **Phone format**: `+56 9 8765 4321`.
- **Vehicle categories**: `STANDARD_SEDAN`, `RURAL_4X4_XL` (requires
  `has4x4 = true` on the driver; geofences can set `require4x4 = true`).
- **Trip lifecycle**: `REQUESTED → DISPATCHING → ACCEPTED → DRIVER_ARRIVED →
  IN_PROGRESS → COMPLETED` (or `CANCELLED`). PIN verification (4 digits)
  gates `DRIVER_ARRIVED/ACCEPTED → IN_PROGRESS`.
- **Driver operational status**: `OFFLINE, AVAILABLE, EN_ROUTE_PICKUP,
  ON_TRIP, SUSPENDED`.
- **Demo accounts are not real people** — see README "Domain facts" for the
  disclaimer that applies to every seeded user (valid-format RUTs, fictional
  identities). Real-world data (geofences, GPS landmarks, fuel prices) is
  not fabricated.

## Known spec deviations (and why)

- **SQLite instead of Postgres+PostGIS**: zero-setup requirement. Postgres
  block preserved in a schema header comment; enums became `String` columns
  (SQLite's Prisma connector has no enum support) with allowed values
  documented per-field; PostGIS polygon geometry became a JSON vertex array
  + a TypeScript point-in-polygon function.
- **Google Maps → Leaflet/OpenStreetMap**: no API key should be required to
  run the demo; OSM tiles are free and keyless.
- **Redis omitted**: the reference architecture uses Redis for geo/pub-sub;
  this demo runs Socket.io directly against Express with an in-process
  dispatch/telemetry loop, sufficient for the ~5-driver demo fleet.
- **Fuel-sync trigger vs. base indexation**: kept both figures from the
  spec's two source documents — `0.02` factor-rounding damping band, and a
  `$25 CLP/L` price-change threshold that gates when a station's benchmark
  is even re-indexed.
