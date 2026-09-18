# CabrasGo

Ride-sharing / mobility platform for **Las Cabras, Peumo, San Vicente de Tagua
Tagua and the Lago Rapel basin** (VI Región de O'Higgins, Chile). Three apps —
Pasajero, Conductor and Admin — talk to a single Node/TypeScript backend over
REST + WebSockets.

This is a **working full-stack demo**: real backend logic (fare algorithm,
trip lifecycle, wallet/payouts, geofencing), a real SQLite database, and a
real React frontend wired to it end-to-end. Payment gateways (Transbank
Webpay, BancoEstado TEF) and the CNE fuel-price feed are **mocked behind the
same interfaces the spec defines** — clearly marked `sandbox` in the code —
since this environment has no real credentials for them. No Google Maps key
is required: maps use **Leaflet + OpenStreetMap** tiles.

## Quick start (one command)

From the repo root:

```bash
npm run setup   # installs backend + frontend deps, provisions the SQLite DB, seeds demo data
npm run dev     # runs backend (:8080) and frontend (:5173) together
```

Then open **http://localhost:5173**. Login with any seeded demo account —
password `cabrasgo2025` for all of them (the login screen lists every seeded
account so you can pick one with a click). **These are seed/test accounts,
not real people** — see "Domain facts" below.

Nothing else is required: `backend/.env.example` ships safe sandbox defaults
(SQLite file DB, a demo `JWT_SECRET`, placeholder Transbank/BancoEstado/CNE
keys) and is auto-copied to `backend/.env` on `npm install` if missing.

### Running the pieces separately

```bash
cd backend && npm install && npm run prisma:generate && npm run prisma:push && npm run seed && npm run dev
cd frontend && npm install && npm run dev
```

Backend: http://localhost:8080 (health check at `/api/v1/health`).
Frontend dev server: http://localhost:5173 (proxies `/api/v1` and
`/socket.io` to the backend — see `frontend/vite.config.ts`).

### Production build

```bash
npm run build   # tsc build for backend, tsc+vite build for frontend
```

## Architecture

```
frontend/  Vite + React + TypeScript + Tailwind, one SPA with three role
           areas: /pasajero (light), /conductor (dark OLED), /admin
           (desktop dashboard). Talks to the backend via fetch + Socket.io
           client. Maps: react-leaflet + OpenStreetMap tiles (no API key).

backend/   Express + TypeScript + Prisma ORM + SQLite (file-based, zero
           external services). Socket.io for the 15s trip-dispatch channel
           and driver telemetry. A server-side interval simulates driver
           GPS movement along each active trip's route (no real GPS in this
           environment), so the passenger's live map reflects real backend
           state over the socket, not client-side fakery.
```

Full technical blueprint: `fase_1.4_manual_técnico_y_de_integración` (DB
schema, fare algorithm, REST contracts, WebSocket channels) plus the unified
spec `fases 1.1-1.4` for exact real-world constants — both supplied as the
authoring reference for this build (not included in the repo).

### Why SQLite instead of Postgres+PostGIS

The reference manual specifies `postgresql + postgis`. For a zero-setup demo
this repo uses SQLite instead:
- `backend/prisma/schema.prisma` has a header comment with the exact
  Postgres+PostGIS `datasource`/`generator` block to swap back in for
  production, plus the two other adaptations needed (enums → `String`
  columns — Prisma's SQLite connector has no native enum support — and
  `String[]` → JSON-encoded string for `Rating.feedbackTags`).
- Geofence containment (`ST_Contains` in PostGIS) is implemented as a
  standard ray-casting point-in-polygon function in TypeScript:
  `backend/src/lib/geofence.ts`. Polygons are stored as JSON `[[lat,lng],...]`
  vertex arrays on `GeofenceZone.boundaryPolygonJson`.

### Mocked integrations (sandbox, not live)

| Spec integration | This build |
|---|---|
| Transbank Webpay Oneclick | Mock gateway ref (`SBX-...`) in `POST /passenger/trips/:id/pay`; real credentials would replace this in production. |
| BancoEstado TEF (CuentaRUT payout) | Mock batch ref (`PAGO-PROV-...`) in `POST /driver/wallet/payout-request`. |
| CNE/ENAP fuel price feed | `POST /admin/fuel/sync-cne` nudges the three seeded stations with a small random walk and only re-indexes a station when the delta exceeds the $25 CLP/L trigger from the spec — seeded with the real published prices below, not live-fetched. |
| Google Maps | Not used. Frontend renders real map tiles via Leaflet + OpenStreetMap (`frontend/src/components/LiveMap.tsx`), which needs no API key. |
| Live driver GPS | Simulated server-side: `backend/src/ws/socket.ts` nudges each active trip's assigned driver toward pickup/destination every 1.5s and broadcasts the real, persisted position. |

## Fare algorithm (section 3 of the technical manual)

```
Tarifa = [ B + (D_pav·C_pav) + (D_ripio·C_ripio) + (T_est·C_min) ] × M_estival × F_combustible
```

- `B` = bajada de bandera = **$1.200 CLP**
- `C_pav` = **$350 CLP/km** asfalto (Ruta H-66 / Av. O'Higgins)
- `C_ripio` = **$550 CLP/km** ripio compactado / huella ribereña
- `C_min` = **$120 CLP/minuto** estimado de viaje
- `M_estival` = multiplicador dinámico por geocerca (ej. 1.35× en Llallauquén / Marina Golf en temporada alta)
- `F_combustible = 1 + ((precioPromedioActual − 1.250) / 1.250 × 0.25)`, con banda de amortiguación: si `|F − 1.00| < 0.02` se redondea a `1.00`.
- El precio de referencia de combustible sólo se re-indexa cuando varía más de **$25 CLP/L** respecto del último benchmark (`FUEL_PRICE_SYNC_TRIGGER_CLP` en `backend/src/lib/fare.ts`).
- Split 85% conductor / 15% comisión comunal (`splitFare`).

Implementation: `backend/src/lib/fare.ts` (constants + `computeFare`),
consumed by `backend/src/lib/quote.ts` (quote endpoint) and
`backend/src/routes/passenger.ts` (trip request, which persists the same
computation on the `Trip` row).

## Domain facts (VI Región / Las Cabras)

- **Geofences** (`backend/prisma/seed.ts`): `LAS_CABRAS_CENTRO`,
  `MARINA_GOLF_RAPEL` (1.35×, ripio surcharge), `LLALLAUQUEN` (1.35×,
  requires 4x4), `EL_MANZANO` (1.15×, requires 4x4).
- **Fuel benchmarks** (real published prices, seeded with today's date):
  Copec Las Cabras Centro (Av. Carlos Valdovinos 450) — gasolina 93 $1.294,
  diésel $1.042; Shell Cruce Las Cabras (Ruta H-66 km 28) — $1.298 / $1.046;
  Petrobras El Manzano (Camino Ribereño s/n) — $1.312 / $1.060.
- **10 validated GPS landmarks** from the GPS audit report (Plaza de Armas,
  Marina Golf Rapel, El Manzano, Balneario Llallauquén, Hospital de Las
  Cabras, Cruce Las Cabras, Punta Verde, Cocalán, Cruce Peumo–San Vicente,
  Cerro Llallauquén) — `backend/src/lib/landmarks.ts`, exposed via
  `GET /api/v1/passenger/landmarks` and used for passenger quick-access
  chips and the admin map.
- **Payment methods**: Webpay Oneclick (Transbank), CuentaRUT BancoEstado,
  Efectivo.
- **RUT**: Chilean format `12.345.678-9` with real módulo-11 check-digit
  validation (`backend/src/lib/chile.ts`).
- **Patente**: `LK · PX · 84` format.
- **Phone**: `+56 9 8765 4321`.

### Demo accounts are not real people

Every seeded user (passengers, drivers, admin) is a **seed/test account**
generated for this demo — RUTs are computed with the real módulo-11
algorithm so they are *valid-format* Chilean RUTs, but they do not belong to
real individuals. The login screen and `GET /api/v1/auth/demo-accounts`
label them as demo accounts; the seed script prints the same disclaimer.
Geofence coordinates, GPS landmarks and fuel prices, by contrast, are the
real values from the project's spec documents, not invented.

## Repository layout

```
backend/
  prisma/schema.prisma   SQLite schema (Postgres+PostGIS alternative documented inline)
  prisma/seed.ts         Real geofences, fuel benchmarks, demo users/drivers
  src/lib/                fare.ts, geofence.ts, chile.ts, quote.ts, landmarks.ts, auth.ts
  src/routes/             auth.ts, passenger.ts, driver.ts, admin.ts
  src/ws/socket.ts        Socket.io: dispatch, telemetry, movement simulation
  src/index.ts            Express app entrypoint
frontend/
  src/pages/Login.tsx
  src/pages/pasajero/PasajeroApp.tsx
  src/pages/conductor/ConductorApp.tsx
  src/pages/admin/AdminApp.tsx
  src/components/LiveMap.tsx   Leaflet + OpenStreetMap map component
  src/lib/                     api.ts, socket.ts, format.ts, landmarks.ts
CLAUDE.md   business/domain knowledge reference for this project
```
