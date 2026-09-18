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
trip lifecycle, driver payouts (commission-based split, admin-configurable
70%-85% driver net), and an admin control panel for KPIs, geofences, KYC
and the commission/revenue model described below.

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
backend/src/lib/platformConfig.ts  Commission/cancellation/VIP/bonus config (single-row PlatformConfig)
backend/src/lib/weeklyBonus.ts     Rolling-week driver goal bonus grant logic
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
- Driver/platform split: `driverNetClp` / `platformFeeClp`, admin-configurable
  via `PlatformConfig.commissionPct` and clamped to 15%-30% commission
  (70%-85% driver net) — see "Business / commission model" below. Starting
  seed default is 15% commission / 85% driver net.

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

## Business / commission model

CabrasGo formalizes three roles' worth of business logic on top of the
trip lifecycle above:

- **Cliente**: requests trips, quotes, pays (Webpay/CuentaRUT/cash), rates —
  unchanged.
- **Conductor**: earns from four attributed streams, all visible as
  separate line items in `GET /driver/wallet`'s `earningsBreakdown`:
  1. **Fare base** — the commission-split net of each completed trip.
  2. **Dynamic/surge pricing** — the portion of the fare-split net
     attributable to a geofence's `dynamicMultiplier` > 1 (e.g. Llallauquén
     high season), broken out as "additional income" rather than folded
     into the base.
  3. **Weekly goal bonus** — `DriverWeeklyBonus`, granted automatically
     (`src/lib/weeklyBonus.ts`) the first time a driver crosses the
     admin-configured trip threshold within a rolling Monday-start week.
  4. **Tips** — `Rating.tipClp`, credited to the wallet at rating time and
     surfaced distinctly from the fare split.
  VIP drivers (`Driver.isVip`) also get proximity-tier dispatch priority
  (see below).
- **Administrador**: owns `PlatformConfig` (single-row settings, admin
  UI under "Modelo de Negocio"), which drives:
  - **Commission**: `commissionPct`, constrained to **15%-30%**
    (driver net 70%-85%) via `fare.ts`'s `DRIVER_NET_PCT_MIN/MAX` and
    `platformConfig.ts`'s `clampCommissionPct`. Replaces the old hardcoded
    85/15 split; every new trip request reads the live value.
  - **Cancellation penalties**: `cancellationFeePassengerClp` /
    `cancellationFeeDriverClp`, charged once a driver has accepted
    (`POST /passenger/trips/:id/cancel`, `POST /driver/trips/:id/cancel`),
    persisted on the `Trip` row (`cancelledBy`, `cancellationFeeClp`) and
    rolled up in `GET /admin/business/overview`. A passenger-caused
    cancellation compensates the driver (same commission split); a
    driver-caused cancellation is a straight penalty.
  - **In-app advertising**: `AdCampaign` (title/body/audience/active),
    admin CRUD under `/admin/ads`, rendered as a banner by both the
    pasajero and conductor apps via `GET /passenger/ads` /
    `GET /driver/ads`.
  - **VIP/priority driver subscriptions**: `Driver.isVip` +
    `PlatformConfig.vipMonthlyFeeClp`, toggled by the admin
    (`PUT /admin/drivers/:id/vip`). In `dispatchTrip`
    (`src/routes/passenger.ts`), candidates are grouped into 3km proximity
    tiers by pickup distance; within the same tier a VIP driver is offered
    the trip before a non-VIP one (VIP never lets a far-away driver jump a
    much closer one — it only breaks ties within a tier).
  - **Admin dashboard** ("Modelo de Negocio" tab): current commission %,
    cancellation-fee revenue, ad campaign manager, VIP driver list and
    projected monthly revenue, and weekly bonus payouts — all computed
    from real rows via `GET /admin/business/overview`.

### Why this stack has near-zero operating cost (vs. Uber's)

This is informational, not a subsystem to build further — it explains a
deliberate set of "known spec deviations" already listed above, from a
cost angle:

- **SQLite instead of managed Postgres + Redis**: no database or cache
  cluster to provision or pay for at this fleet size (~5 drivers); a
  single file on disk. Uber's stack runs sharded Postgres/Schemaless plus
  Redis for geo/dispatch state — real infra spend even at low volume.
- **Leaflet + OpenStreetMap instead of the Google Maps Platform**: no
  per-load/per-request API billing and no API key to provision; OSM tiles
  are free. Google Maps' Directions/Places/Maps SDK billing is one of a
  rideshare app's largest fixed costs at scale.
- **Self-hosted/sandboxed payment integrations** (`Trip.paymentGatewayRef`
  mocks Webpay/BancoEstado TEF): no live merchant account or per-transaction
  gateway markup while in development — the request/response shape matches
  the real Transbank/BancoEstado sandbox contracts so swapping in real
  credentials later is a config change, not a rewrite.
- **No third-party SMS/push vendor**: rider/driver notifications ride the
  existing Socket.io channel instead of a metered SMS (Twilio-style) or
  push (FCM/APNs-gateway) service.
- **Socket.io directly over Express instead of a managed pub/sub (Redis,
  Kafka)**: sufficient for the demo fleet's dispatch cascade and telemetry
  stream; the code is structured (see `src/ws/socket.ts`) so a real pub/sub
  backend could replace the in-process loop without changing the REST or
  socket event contracts.

None of this is a permanent architecture decision — the schema header
comment and "Known spec deviations" section above document the exact swap
path to Postgres+PostGIS/Redis/Google Maps for a production deployment at
scale. The point is that CabrasGo can run its full commission/business
model end-to-end today with **zero external paid services**.
