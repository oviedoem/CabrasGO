import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getUser, clearSession } from "../../lib/api";
import { formatClp, formatPatente } from "../../lib/format";
import { LiveMap } from "../../components/LiveMap";
import { LANDMARKS_CENTER } from "../../lib/landmarks";

interface Kpis {
  gmvTodayClp: number;
  activeDrivers: number;
  totalDrivers: number;
  onTripDrivers: number;
  completedTripsToday: number;
  completionRatePct: number;
  fleetStatus: { status: string; count: number }[];
}

interface RadarDriver {
  id: string;
  name: string;
  plate: string;
  model: string;
  status: string;
  lat: number | null;
  lng: number | null;
  speedKmh: number;
  batteryPct: number | null;
  rating: number;
  isKycVerified: boolean;
  isVip: boolean;
}

interface GeofenceZone {
  id: string;
  code: string;
  name: string;
  isHighDemand: boolean;
  dynamicMultiplier: string | number;
  require4x4: boolean;
  dirtRoadSurchargeClp: number;
  boundaryPolygon: { lat: number; lng: number }[];
}

interface FuelBenchmark {
  id: string;
  stationName: string;
  stationAddress: string;
  comuna: string;
  gasoline93Clp: number;
  dieselClp: number;
  reportedAt: string;
}

interface PlatformConfigData {
  id: string;
  commissionPct: string | number;
  cancellationFeePassengerClp: number;
  cancellationFeeDriverClp: number;
  weeklyBonusTripThreshold: number;
  weeklyBonusAmountClp: number;
  vipMonthlyFeeClp: number;
}

interface BusinessOverview {
  commission: { commissionPct: number; driverNetPct: number; minPct: number; maxPct: number; revenueClp: number; gmvClp: number };
  cancellations: { feePassengerClp: number; feeDriverClp: number; revenueClp: number; chargedCount: number; byParty: { passenger: number; driver: number } };
  vip: { monthlyFeeClp: number; vipDriverCount: number; projectedMonthlyRevenueClp: number };
  weeklyBonus: { tripThreshold: number; amountClp: number; totalPaidClp: number; grantCount: number };
  ads: { totalCount: number; activeCount: number };
}

interface AdCampaign {
  id: string;
  title: string;
  bodyText: string;
  imageUrl: string | null;
  targetAudience: "PASAJERO" | "CONDUCTOR" | "AMBOS";
  active: boolean;
}

interface WeeklyBonusRow {
  id: string;
  driverName: string;
  weekStart: string;
  tripsCompleted: number;
  bonusClp: number;
}

const STATUS_LABEL: Record<string, string> = {
  OFFLINE: "Desconectado",
  AVAILABLE: "Libre",
  EN_ROUTE_PICKUP: "Hacia cliente",
  ON_TRIP: "Con pasajero",
  SUSPENDED: "Suspendido",
};

export function AdminApp() {
  const navigate = useNavigate();
  const user = getUser();
  const [tab, setTab] = useState<"kpis" | "flota" | "geocercas" | "combustible" | "usuarios" | "negocio">("kpis");
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [drivers, setDrivers] = useState<RadarDriver[]>([]);
  const [zones, setZones] = useState<GeofenceZone[]>([]);
  const [fuel, setFuel] = useState<FuelBenchmark[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [config, setConfig] = useState<PlatformConfigData | null>(null);
  const [overview, setOverview] = useState<BusinessOverview | null>(null);
  const [ads, setAds] = useState<AdCampaign[]>([]);
  const [bonuses, setBonuses] = useState<WeeklyBonusRow[]>([]);

  useEffect(() => {
    if (!user || (user.role !== "ADMIN" && user.role !== "DISPATCHER")) {
      navigate("/");
      return;
    }
    refreshAll();
    const interval = setInterval(refreshAll, 4000);
    return () => clearInterval(interval);
  }, []);

  function refreshAll() {
    api.get<Kpis>("/admin/kpis/realtime").then(setKpis).catch(() => {});
    api.get<{ drivers: RadarDriver[] }>("/admin/drivers/radar").then((d) => setDrivers(d.drivers)).catch(() => {});
    api.get<{ zones: GeofenceZone[] }>("/admin/geofences").then((d) => setZones(d.zones)).catch(() => {});
    api.get<{ benchmarks: FuelBenchmark[] }>("/admin/fuel/benchmarks").then((d) => setFuel(d.benchmarks)).catch(() => {});
    api.get<{ users: any[] }>("/admin/users").then((d) => setUsers(d.users)).catch(() => {});
    api.get<{ config: PlatformConfigData }>("/admin/config").then((d) => setConfig(d.config)).catch(() => {});
    api.get<BusinessOverview>("/admin/business/overview").then(setOverview).catch(() => {});
    api.get<{ ads: AdCampaign[] }>("/admin/ads").then((d) => setAds(d.ads)).catch(() => {});
    api.get<{ bonuses: WeeklyBonusRow[] }>("/admin/bonuses/weekly").then((d) => setBonuses(d.bonuses)).catch(() => {});
  }

  async function updateZone(code: string, patch: Partial<GeofenceZone>) {
    await api.put(`/admin/geofences/${code}`, patch);
    refreshAll();
  }

  async function syncFuel() {
    await api.post("/admin/fuel/sync-cne");
    refreshAll();
  }

  async function updateConfig(patch: Partial<PlatformConfigData>) {
    await api.put("/admin/config", patch);
    refreshAll();
  }

  async function toggleVip(driverId: string, isVip: boolean) {
    await api.put(`/admin/drivers/${driverId}/vip`, { isVip });
    refreshAll();
  }

  async function createAd(ad: { title: string; bodyText: string; targetAudience: string }) {
    await api.post("/admin/ads", ad);
    refreshAll();
  }

  async function toggleAd(id: string, active: boolean) {
    await api.put(`/admin/ads/${id}`, { active });
    refreshAll();
  }

  async function deleteAd(id: string) {
    await api.del(`/admin/ads/${id}`);
    refreshAll();
  }

  function logout() {
    clearSession();
    navigate("/");
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-cg-bg text-cg-primary">
      <header className="flex items-center justify-between px-6 py-4 bg-cg-primary text-white">
        <div className="flex items-center gap-3">
          <img src="/logo.png" className="w-9 h-9 rounded-lg" />
          <div>
            <p className="font-bold leading-none">CabrasGo · Centro de Control</p>
            <p className="text-xs opacity-70">Las Cabras · Peumo · San Vicente · Lago Rapel</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="opacity-80">{user.firstName} {user.lastName}</span>
          <button onClick={logout} className="text-red-300 font-medium">Salir</button>
        </div>
      </header>

      <nav className="flex gap-1 bg-white shadow-sm px-6">
        {([
          ["kpis", "KPIs en Vivo"],
          ["flota", "Radar de Flotas"],
          ["geocercas", "Geocercas"],
          ["combustible", "Combustibles"],
          ["usuarios", "Usuarios & KYC"],
          ["negocio", "Modelo de Negocio"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-3 text-sm font-semibold border-b-2 ${
              tab === key ? "border-cg-accent text-cg-accent" : "border-transparent text-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="p-6 max-w-6xl mx-auto">
        {tab === "kpis" && kpis && <KpiTab kpis={kpis} />}
        {tab === "flota" && <FleetTab drivers={drivers} onToggleVip={toggleVip} />}
        {tab === "geocercas" && <GeofenceTab zones={zones} onUpdate={updateZone} />}
        {tab === "combustible" && <FuelTab fuel={fuel} onSync={syncFuel} />}
        {tab === "usuarios" && <UsersTab users={users} />}
        {tab === "negocio" && config && overview && (
          <NegocioTab
            config={config}
            overview={overview}
            ads={ads}
            bonuses={bonuses}
            drivers={drivers}
            onUpdateConfig={updateConfig}
            onToggleVip={toggleVip}
            onCreateAd={createAd}
            onToggleAd={toggleAd}
            onDeleteAd={deleteAd}
          />
        )}
      </main>
    </div>
  );
}

function KpiTab({ kpis }: { kpis: Kpis }) {
  const cards = [
    { label: "GMV Hoy (CLP)", value: formatClp(kpis.gmvTodayClp) },
    { label: "Conductores activos", value: `${kpis.activeDrivers} / ${kpis.totalDrivers}` },
    { label: "Con pasajero", value: kpis.onTripDrivers },
    { label: "Viajes completados hoy", value: kpis.completedTripsToday },
    { label: "Tasa de completitud", value: `${kpis.completionRatePct}%` },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="bg-cg-surface rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{c.label}</p>
            <p className="text-2xl font-bold">{c.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-cg-surface rounded-2xl p-4 shadow-sm">
        <p className="text-sm font-semibold mb-3">Estado de flota</p>
        <div className="flex gap-4 flex-wrap">
          {kpis.fleetStatus.map((s) => (
            <div key={s.status} className="bg-cg-surfaceAlt rounded-xl px-4 py-3">
              <p className="text-xs text-slate-500">{STATUS_LABEL[s.status] ?? s.status}</p>
              <p className="text-xl font-bold">{s.count}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FleetTab({
  drivers,
  onToggleVip,
}: {
  drivers: RadarDriver[];
  onToggleVip: (driverId: string, isVip: boolean) => void;
}) {
  return (
    <div>
      <div className="mb-4">
        <LiveMap
          center={LANDMARKS_CENTER}
          zoom={11}
          height={340}
          markers={drivers
            .filter((d) => d.lat && d.lng)
            .map((d) => ({
              id: d.id,
              lat: d.lat as number,
              lng: d.lng as number,
              label: d.name,
              sub: `${d.model} · ${formatPatente(d.plate)} · ${STATUS_LABEL[d.status] ?? d.status}`,
              kind: "car" as const,
            }))}
        />
      </div>
      <div className="bg-cg-surface rounded-2xl shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-cg-surfaceAlt text-slate-500">
          <tr>
            <th className="text-left px-4 py-3">Conductor</th>
            <th className="text-left px-4 py-3">Vehículo</th>
            <th className="text-left px-4 py-3">Estado</th>
            <th className="text-left px-4 py-3">GPS</th>
            <th className="text-left px-4 py-3">Vel.</th>
            <th className="text-left px-4 py-3">Batería</th>
            <th className="text-left px-4 py-3">KYC</th>
            <th className="text-left px-4 py-3">VIP</th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((d) => (
            <tr key={d.id} className="border-t border-slate-100">
              <td className="px-4 py-3 font-medium">
                {d.name} <span className="text-xs text-slate-400">⭐{d.rating.toFixed(1)}</span>
                {d.isVip && <span className="ml-1 text-[10px] font-bold bg-amber-400 text-black rounded-full px-2 py-0.5">VIP</span>}
              </td>
              <td className="px-4 py-3">{d.model} · {formatPatente(d.plate)}</td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-emerald-50 text-cg-earnings px-2 py-1 text-xs font-semibold">
                  {STATUS_LABEL[d.status] ?? d.status}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-slate-500">{d.lat && d.lng ? `${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}` : "—"}</td>
              <td className="px-4 py-3">{Math.round(d.speedKmh)} km/h</td>
              <td className="px-4 py-3">{d.batteryPct}%</td>
              <td className="px-4 py-3">{d.isKycVerified ? "✅" : "⏳"}</td>
              <td className="px-4 py-3">
                <button
                  onClick={() => onToggleVip(d.id, !d.isVip)}
                  className={`text-xs font-semibold rounded-full px-3 py-1 ${
                    d.isVip ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {d.isVip ? "Quitar VIP" : "Hacer VIP"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

const ZONE_COLORS: Record<string, string> = {
  LAS_CABRAS_CENTRO: "#0F172A",
  MARINA_GOLF_RAPEL: "#10B981",
  LLALLAUQUEN: "#F59E0B",
  EL_MANZANO: "#EF4444",
};

function GeofenceTab({ zones, onUpdate }: { zones: GeofenceZone[]; onUpdate: (code: string, patch: Partial<GeofenceZone>) => void }) {
  return (
    <div>
      <div className="mb-4">
        <LiveMap
          center={LANDMARKS_CENTER}
          zoom={11}
          height={340}
          markers={[]}
          polygons={zones.map((z) => ({
            id: z.code,
            positions: z.boundaryPolygon.map((p) => [p.lat, p.lng] as [number, number]),
            color: ZONE_COLORS[z.code] ?? "#10B981",
          }))}
        />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
      {zones.map((z) => (
        <div key={z.code} className="bg-cg-surface rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold">{z.name}</p>
            {z.isHighDemand && <span className="text-xs bg-amber-50 text-cg-warning px-2 py-1 rounded-full font-semibold">Alta demanda</span>}
          </div>
          <p className="text-xs text-slate-400 mb-3">{z.code}</p>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-sm text-slate-500 w-40">Multiplicador estival</label>
            <input
              type="number"
              step="0.05"
              defaultValue={Number(z.dynamicMultiplier)}
              onBlur={(e) => onUpdate(z.code, { dynamicMultiplier: Number(e.target.value) })}
              className="border border-slate-200 rounded-lg px-2 py-1 w-24 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-sm text-slate-500 w-40">Recargo ripio (CLP)</label>
            <input
              type="number"
              defaultValue={z.dirtRoadSurchargeClp}
              onBlur={(e) => onUpdate(z.code, { dirtRoadSurchargeClp: Number(e.target.value) })}
              className="border border-slate-200 rounded-lg px-2 py-1 w-24 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              defaultChecked={z.require4x4}
              onChange={(e) => onUpdate(z.code, { require4x4: e.target.checked })}
            />
            Exige vehículo 4x4
          </label>
        </div>
      ))}
      </div>
    </div>
  );
}

function FuelTab({ fuel, onSync }: { fuel: FuelBenchmark[]; onSync: () => void }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">Fuente: CNE / ENAP (sandbox) · gatilla re-indexación con variación &gt; $25 CLP/L</p>
        <button onClick={onSync} className="bg-cg-accent text-white font-semibold rounded-xl px-4 py-2 text-sm">
          Sincronizar CNE ahora
        </button>
      </div>
      <div className="bg-cg-surface rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cg-surfaceAlt text-slate-500">
            <tr>
              <th className="text-left px-4 py-3">Servicentro</th>
              <th className="text-left px-4 py-3">Dirección</th>
              <th className="text-left px-4 py-3">Comuna</th>
              <th className="text-left px-4 py-3">Gasolina 93</th>
              <th className="text-left px-4 py-3">Diésel</th>
              <th className="text-left px-4 py-3">Actualizado</th>
            </tr>
          </thead>
          <tbody>
            {fuel.map((f) => (
              <tr key={f.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">{f.stationName}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{f.stationAddress}</td>
                <td className="px-4 py-3">{f.comuna}</td>
                <td className="px-4 py-3">{formatClp(f.gasoline93Clp)}/L</td>
                <td className="px-4 py-3">{formatClp(f.dieselClp)}/L</td>
                <td className="px-4 py-3 text-xs text-slate-400">{new Date(f.reportedAt).toLocaleString("es-CL")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NegocioTab({
  config,
  overview,
  ads,
  bonuses,
  drivers,
  onUpdateConfig,
  onToggleVip,
  onCreateAd,
  onToggleAd,
  onDeleteAd,
}: {
  config: PlatformConfigData;
  overview: BusinessOverview;
  ads: AdCampaign[];
  bonuses: WeeklyBonusRow[];
  drivers: RadarDriver[];
  onUpdateConfig: (patch: Partial<PlatformConfigData>) => void;
  onToggleVip: (driverId: string, isVip: boolean) => void;
  onCreateAd: (ad: { title: string; bodyText: string; targetAudience: string }) => void;
  onToggleAd: (id: string, active: boolean) => void;
  onDeleteAd: (id: string) => void;
}) {
  const [newAdTitle, setNewAdTitle] = useState("");
  const [newAdBody, setNewAdBody] = useState("");
  const [newAdAudience, setNewAdAudience] = useState("AMBOS");

  const vipDrivers = drivers.filter((d) => d.isVip);

  return (
    <div className="space-y-8">
      {/* Revenue overview */}
      <div>
        <p className="text-sm font-semibold text-slate-600 mb-2">Fuentes de ingreso de la plataforma</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-cg-surface rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Comisión ({overview.commission.commissionPct}%)</p>
            <p className="text-xl font-bold">{formatClp(overview.commission.revenueClp)}</p>
            <p className="text-xs text-slate-400 mt-1">GMV {formatClp(overview.commission.gmvClp)}</p>
          </div>
          <div className="bg-cg-surface rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Penalidades de cancelación</p>
            <p className="text-xl font-bold">{formatClp(overview.cancellations.revenueClp)}</p>
            <p className="text-xs text-slate-400 mt-1">{overview.cancellations.chargedCount} viajes cobrados</p>
          </div>
          <div className="bg-cg-surface rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Suscripciones VIP (proyectado/mes)</p>
            <p className="text-xl font-bold">{formatClp(overview.vip.projectedMonthlyRevenueClp)}</p>
            <p className="text-xs text-slate-400 mt-1">{overview.vip.vipDriverCount} conductores VIP</p>
          </div>
          <div className="bg-cg-surface rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Bonos pagados (meta semanal)</p>
            <p className="text-xl font-bold">{formatClp(overview.weeklyBonus.totalPaidClp)}</p>
            <p className="text-xs text-slate-400 mt-1">{overview.weeklyBonus.grantCount} bonos otorgados</p>
          </div>
        </div>
      </div>

      {/* Commission + cancellation + bonus + VIP config */}
      <div>
        <p className="text-sm font-semibold text-slate-600 mb-2">Configuración de comisión y penalidades</p>
        <div className="bg-cg-surface rounded-2xl p-4 shadow-sm grid md:grid-cols-2 gap-4">
          <ConfigField
            label={`Comisión plataforma (%) — rango ${overview.commission.minPct}-${overview.commission.maxPct}`}
            defaultValue={Number(config.commissionPct)}
            onBlur={(v) => onUpdateConfig({ commissionPct: v })}
          />
          <p className="text-xs text-slate-400 self-center">
            Conductor neto actual: <b>{100 - Number(config.commissionPct)}%</b> por viaje
          </p>
          <ConfigField
            label="Penalidad cancelación pasajero (CLP)"
            defaultValue={config.cancellationFeePassengerClp}
            onBlur={(v) => onUpdateConfig({ cancellationFeePassengerClp: v })}
          />
          <ConfigField
            label="Penalidad cancelación conductor (CLP)"
            defaultValue={config.cancellationFeeDriverClp}
            onBlur={(v) => onUpdateConfig({ cancellationFeeDriverClp: v })}
          />
          <ConfigField
            label="Meta semanal (N° viajes)"
            defaultValue={config.weeklyBonusTripThreshold}
            onBlur={(v) => onUpdateConfig({ weeklyBonusTripThreshold: v })}
          />
          <ConfigField
            label="Bono por meta semanal (CLP)"
            defaultValue={config.weeklyBonusAmountClp}
            onBlur={(v) => onUpdateConfig({ weeklyBonusAmountClp: v })}
          />
          <ConfigField
            label="Cuota mensual VIP (CLP)"
            defaultValue={config.vipMonthlyFeeClp}
            onBlur={(v) => onUpdateConfig({ vipMonthlyFeeClp: v })}
          />
        </div>
      </div>

      {/* VIP drivers */}
      <div>
        <p className="text-sm font-semibold text-slate-600 mb-2">Conductores VIP ({vipDrivers.length})</p>
        <div className="bg-cg-surface rounded-2xl shadow-sm overflow-hidden">
          {vipDrivers.length === 0 ? (
            <p className="text-sm text-slate-400 p-4">Ningún conductor VIP todavía.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {vipDrivers.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium">{d.name}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{formatPatente(d.plate)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => onToggleVip(d.id, false)} className="text-xs text-cg-danger font-semibold">
                        Quitar VIP
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Weekly bonuses */}
      <div>
        <p className="text-sm font-semibold text-slate-600 mb-2">Bonos por meta semanal otorgados</p>
        <div className="bg-cg-surface rounded-2xl shadow-sm overflow-hidden">
          {bonuses.length === 0 ? (
            <p className="text-sm text-slate-400 p-4">Sin bonos otorgados aún.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-cg-surfaceAlt text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3">Conductor</th>
                  <th className="text-left px-4 py-3">Semana</th>
                  <th className="text-left px-4 py-3">Viajes</th>
                  <th className="text-left px-4 py-3">Bono</th>
                </tr>
              </thead>
              <tbody>
                {bonuses.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium">{b.driverName}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{new Date(b.weekStart).toLocaleDateString("es-CL")}</td>
                    <td className="px-4 py-3">{b.tripsCompleted}</td>
                    <td className="px-4 py-3 font-semibold">{formatClp(b.bonusClp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Ad campaigns */}
      <div>
        <p className="text-sm font-semibold text-slate-600 mb-2">
          Campañas publicitarias in-app ({overview.ads.activeCount} activas / {overview.ads.totalCount})
        </p>
        <div className="bg-cg-surface rounded-2xl p-4 shadow-sm mb-3 grid md:grid-cols-4 gap-2">
          <input
            value={newAdTitle}
            onChange={(e) => setNewAdTitle(e.target.value)}
            placeholder="Título"
            className="border border-slate-200 rounded-lg px-2 py-2 text-sm md:col-span-1"
          />
          <input
            value={newAdBody}
            onChange={(e) => setNewAdBody(e.target.value)}
            placeholder="Texto del anuncio"
            className="border border-slate-200 rounded-lg px-2 py-2 text-sm md:col-span-2"
          />
          <select
            value={newAdAudience}
            onChange={(e) => setNewAdAudience(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-2 text-sm"
          >
            <option value="AMBOS">Ambos</option>
            <option value="PASAJERO">Pasajero</option>
            <option value="CONDUCTOR">Conductor</option>
          </select>
          <button
            onClick={() => {
              if (!newAdTitle || !newAdBody) return;
              onCreateAd({ title: newAdTitle, bodyText: newAdBody, targetAudience: newAdAudience });
              setNewAdTitle("");
              setNewAdBody("");
            }}
            className="md:col-span-4 bg-cg-accent text-white font-semibold rounded-xl py-2 text-sm"
          >
            Crear campaña
          </button>
        </div>
        <div className="bg-cg-surface rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cg-surfaceAlt text-slate-500">
              <tr>
                <th className="text-left px-4 py-3">Campaña</th>
                <th className="text-left px-4 py-3">Audiencia</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-left px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {ads.map((ad) => (
                <tr key={ad.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <p className="font-medium">{ad.title}</p>
                    <p className="text-xs text-slate-400">{ad.bodyText}</p>
                  </td>
                  <td className="px-4 py-3">{ad.targetAudience}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onToggleAd(ad.id, !ad.active)}
                      className={`text-xs font-semibold rounded-full px-3 py-1 ${
                        ad.active ? "bg-emerald-50 text-cg-earnings" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {ad.active ? "Activa" : "Inactiva"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => onDeleteAd(ad.id)} className="text-xs text-cg-danger font-semibold">
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ConfigField({
  label,
  defaultValue,
  onBlur,
}: {
  label: string;
  defaultValue: number;
  onBlur: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-slate-500 flex-1">{label}</label>
      <input
        type="number"
        defaultValue={defaultValue}
        onBlur={(e) => onBlur(Number(e.target.value))}
        className="border border-slate-200 rounded-lg px-2 py-1 w-28 text-sm"
      />
    </div>
  );
}

function UsersTab({ users }: { users: any[] }) {
  return (
    <div className="bg-cg-surface rounded-2xl shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-cg-surfaceAlt text-slate-500">
          <tr>
            <th className="text-left px-4 py-3">Nombre</th>
            <th className="text-left px-4 py-3">RUT</th>
            <th className="text-left px-4 py-3">Rol</th>
            <th className="text-left px-4 py-3">KYC</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-slate-100">
              <td className="px-4 py-3 font-medium">{u.firstName} {u.lastName}</td>
              <td className="px-4 py-3">{u.rut}</td>
              <td className="px-4 py-3">{u.role}</td>
              <td className="px-4 py-3">{u.driverProfile ? (u.driverProfile.isKycVerified ? "✅ Verificado" : "⏳ Pendiente") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
