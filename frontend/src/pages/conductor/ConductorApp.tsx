import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getUser, clearSession } from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { formatClp, formatPatente } from "../../lib/format";
import { AdBanner } from "../../components/AdBanner";

interface DriverProfile {
  id: string;
  name: string;
  plate: string;
  model: string;
  operationalStatus: string;
  walletBalanceClp: number;
  rating: number;
  totalTrips: number;
  lat: number | null;
  lng: number | null;
  isVip: boolean;
}

interface EarningsBreakdown {
  fareBaseClp: number;
  surgeBonusClp: number;
  tipsClp: number;
  weeklyBonusClp: number;
  cancellationCompensationClp: number;
  cancellationPenaltiesClp: number;
}

interface TripOffer {
  tripId: string;
  expiresInSecs: number;
  netEarningsClp: number;
  grossFareClp: number;
  pickupAddress: string;
  destAddress: string;
  terrainType: string;
  pickupDistanceKm: number;
  requires4x4: boolean;
}

export function ConductorApp() {
  const navigate = useNavigate();
  const user = getUser();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [offer, setOffer] = useState<TripOffer | null>(null);
  const [countdown, setCountdown] = useState(15);
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [pinInput, setPinInput] = useState("");
  const [tab, setTab] = useState<"home" | "wallet">("home");
  const [payoutAmount, setPayoutAmount] = useState("");
  const [wallet, setWallet] = useState<{
    walletBalanceClp: number;
    payouts: any[];
    completedTrips: number;
    earningsBreakdown: EarningsBreakdown;
    weeklyBonuses: any[];
  } | null>(null);
  const [ads, setAds] = useState<{ id: string; title: string; bodyText: string; imageUrl: string | null }[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user || user.role !== "DRIVER") {
      navigate("/");
      return;
    }
    loadProfile();
    loadActiveTrip();
    api.get<{ ads: typeof ads }>("/driver/ads").then((d) => setAds(d.ads)).catch(() => {});
    const socket = getSocket();
    if (user.driverId) socket.emit("join:driver", user.driverId);
    socket.on("trip:dispatch:offer", (payload: TripOffer) => {
      setOffer(payload);
      setCountdown(payload.expiresInSecs);
    });
    return () => {
      socket.off("trip:dispatch:offer");
    };
  }, []);

  useEffect(() => {
    if (!offer) return;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          window.clearInterval(timerRef.current!);
          setOffer(null);
          return 15;
        }
        return c - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [offer]);

  useEffect(() => {
    if (tab === "wallet") {
      api.get<any>("/driver/wallet").then(setWallet);
    }
  }, [tab]);

  async function loadProfile() {
    const p = await api.get<DriverProfile>("/driver/me");
    setProfile(p);
  }

  async function loadActiveTrip() {
    const res = await api.get<{ trip: any }>("/driver/trips/active");
    setActiveTrip(res.trip);
  }

  async function toggleStatus() {
    if (!profile) return;
    const next = profile.operationalStatus === "OFFLINE" ? "AVAILABLE" : "OFFLINE";
    const geo = await new Promise<GeolocationPosition | null>((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        () => resolve(null),
        { timeout: 3000 }
      );
    });
    const body: any = { status: next, batteryPct: 70 + Math.floor(Math.random() * 30) };
    if (geo) {
      body.lat = geo.coords.latitude;
      body.lng = geo.coords.longitude;
    }
    await api.post("/driver/status/toggle", body);
    loadProfile();
  }

  async function acceptOffer() {
    if (!offer) return;
    await api.post(`/driver/trips/${offer.tripId}/accept`);
    setOffer(null);
    loadActiveTrip();
    loadProfile();
  }

  async function declineOffer() {
    if (!offer) return;
    await api.post(`/driver/trips/${offer.tripId}/decline`);
    setOffer(null);
  }

  async function verifyPin() {
    if (!activeTrip) return;
    try {
      await api.post(`/driver/trips/${activeTrip.id}/verify-pin`, { pinEntered: pinInput });
      loadActiveTrip();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function cancelActiveTrip() {
    if (!activeTrip) return;
    if (!window.confirm("Cancelar este viaje aplicará una penalidad de cancelación. ¿Continuar?")) return;
    try {
      await api.post(`/driver/trips/${activeTrip.id}/cancel`);
      setActiveTrip(null);
      setPinInput("");
      loadProfile();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function completeTrip() {
    if (!activeTrip) return;
    await api.post(`/driver/trips/${activeTrip.id}/complete`);
    setActiveTrip(null);
    setPinInput("");
    loadProfile();
  }

  async function requestPayout() {
    const amount = Number(payoutAmount);
    if (!amount) return;
    try {
      await api.post("/driver/wallet/payout-request", { amountClp: amount, targetAccount: "CuentaRUT BancoEstado" });
      setPayoutAmount("");
      api.get<any>("/driver/wallet").then(setWallet);
      loadProfile();
    } catch (e: any) {
      alert(e.message);
    }
  }

  function logout() {
    clearSession();
    navigate("/");
  }

  if (!user || !profile) return <div className="min-h-screen bg-cg-darkBg" />;

  const online = profile.operationalStatus !== "OFFLINE";

  return (
    <div className="min-h-screen bg-cg-darkBg text-cg-darkPrimary">
      <header className="flex items-center justify-between px-4 py-3 bg-cg-darkSurface">
        <div className="flex items-center gap-2">
          <img src="/logo.png" className="w-8 h-8 rounded-lg" />
          <span className="font-bold">CabrasGo Conductor</span>
        </div>
        <button onClick={logout} className="text-cg-danger text-sm font-medium">
          Salir
        </button>
      </header>

      <nav className="flex bg-cg-darkSurfaceAlt">
        {(["home", "wallet"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-semibold ${tab === t ? "text-cg-accent border-b-2 border-cg-accent" : "text-slate-400"}`}
          >
            {t === "home" ? "Operación" : "Billetera"}
          </button>
        ))}
      </nav>

      <main className="max-w-md mx-auto p-4">
        {tab === "home" && (
          <div>
            <AdBanner ads={ads} dark />
            <div className="bg-cg-darkSurface rounded-2xl p-4 mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">{profile.model} · {formatPatente(profile.plate)}</p>
                <p className="font-semibold flex items-center gap-2">
                  {profile.name}
                  {profile.isVip && (
                    <span className="text-[10px] font-bold bg-amber-400 text-black rounded-full px-2 py-0.5">VIP</span>
                  )}
                </p>
                <p className="text-xs text-slate-400 mt-1">⭐ {profile.rating.toFixed(1)} · {profile.totalTrips} viajes</p>
              </div>
              <button
                onClick={toggleStatus}
                disabled={!!activeTrip}
                className={`rounded-full px-5 py-3 font-bold text-sm ${
                  online ? "bg-cg-accent text-black" : "bg-slate-700 text-slate-300"
                } disabled:opacity-50`}
              >
                {online ? "Conectado" : "Desconectado"}
              </button>
            </div>

            <div className="bg-cg-darkSurface rounded-2xl p-4 mb-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide">Saldo billetera</p>
              <p className="text-2xl font-bold text-cg-earningsBright">{formatClp(profile.walletBalanceClp)}</p>
            </div>

            {activeTrip && (
              <ActiveTripCard
                trip={activeTrip}
                pinInput={pinInput}
                setPinInput={setPinInput}
                onVerify={verifyPin}
                onComplete={completeTrip}
                onCancel={cancelActiveTrip}
              />
            )}

            {!activeTrip && !offer && (
              <div className="text-center text-slate-500 text-sm py-10">
                {online ? "Esperando solicitudes de viaje..." : "Conéctate para recibir viajes"}
              </div>
            )}
          </div>
        )}

        {tab === "wallet" && wallet && (
          <div>
            <div className="bg-cg-darkSurface rounded-2xl p-4 mb-4 text-center">
              <p className="text-xs text-slate-400 uppercase">Saldo disponible</p>
              <p className="text-3xl font-bold text-cg-earningsBright">{formatClp(wallet.walletBalanceClp)}</p>
              <p className="text-xs text-slate-400 mt-1">{wallet.completedTrips} viajes completados</p>
            </div>

            <p className="text-sm font-semibold text-slate-400 mb-2">Desglose de ingresos</p>
            <div className="bg-cg-darkSurface rounded-2xl p-4 mb-4 space-y-2 text-sm">
              <EarningsRow label="Tarifa base (split conductor)" value={wallet.earningsBreakdown.fareBaseClp} />
              <EarningsRow label="Tarifa dinámica / surge" value={wallet.earningsBreakdown.surgeBonusClp} />
              <EarningsRow label="Propinas" value={wallet.earningsBreakdown.tipsClp} />
              <EarningsRow label="Bono meta semanal" value={wallet.earningsBreakdown.weeklyBonusClp} />
              <EarningsRow label="Compensación por cancelación" value={wallet.earningsBreakdown.cancellationCompensationClp} />
              {wallet.earningsBreakdown.cancellationPenaltiesClp > 0 && (
                <EarningsRow
                  label="Penalidad por cancelación"
                  value={-wallet.earningsBreakdown.cancellationPenaltiesClp}
                  negative
                />
              )}
            </div>

            {wallet.weeklyBonuses.length > 0 && (
              <>
                <p className="text-sm font-semibold text-slate-400 mb-2">Bonos por meta semanal</p>
                <div className="space-y-2 mb-4">
                  {wallet.weeklyBonuses.map((b: any) => (
                    <div key={b.id} className="bg-cg-darkSurface rounded-xl p-3 flex justify-between text-sm">
                      <span>{b.tripsCompleted} viajes · semana {new Date(b.weekStart).toLocaleDateString("es-CL")}</span>
                      <span className="font-semibold text-cg-earningsBright">{formatClp(b.bonusClp)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="flex gap-2 mb-4">
              <input
                type="number"
                placeholder="Monto a transferir"
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(e.target.value)}
                className="flex-1 bg-cg-darkSurfaceAlt rounded-xl px-4 py-3 text-sm"
              />
              <button onClick={requestPayout} className="bg-cg-accent text-black font-semibold rounded-xl px-4">
                Transferir
              </button>
            </div>
            <p className="text-sm font-semibold text-slate-400 mb-2">Historial de transferencias</p>
            <div className="space-y-2">
              {wallet.payouts.map((p) => (
                <div key={p.id} className="bg-cg-darkSurface rounded-xl p-3 flex justify-between text-sm">
                  <span>{p.tefRefCode}</span>
                  <span className="font-semibold">{formatClp(p.amountClp)}</span>
                </div>
              ))}
              {wallet.payouts.length === 0 && <p className="text-slate-500 text-sm">Sin transferencias aún.</p>}
            </div>
          </div>
        )}
      </main>

      {offer && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50">
          <div className="bg-cg-darkSurface rounded-t-3xl sm:rounded-3xl w-full max-w-md p-6">
            <div className="flex justify-center mb-4">
              <div className="relative w-20 h-20">
                <svg className="w-20 h-20 -rotate-90">
                  <circle cx="40" cy="40" r="34" stroke="#334155" strokeWidth="6" fill="none" />
                  <circle
                    cx="40"
                    cy="40"
                    r="34"
                    stroke="#10B981"
                    strokeWidth="6"
                    fill="none"
                    strokeDasharray={2 * Math.PI * 34}
                    strokeDashoffset={2 * Math.PI * 34 * (1 - countdown / 15)}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-xl font-bold">{countdown}</span>
              </div>
            </div>
            <p className="text-center text-3xl font-bold text-cg-earningsBright mb-1">{formatClp(offer.netEarningsClp)}</p>
            <p className="text-center text-xs text-slate-400 mb-4">Ganancia neta (bruto {formatClp(offer.grossFareClp)})</p>
            <div className="bg-cg-darkSurfaceAlt rounded-xl p-3 mb-4 text-sm space-y-1">
              <p><span className="text-slate-400">Recogida:</span> {offer.pickupAddress} ({offer.pickupDistanceKm} km)</p>
              <p><span className="text-slate-400">Destino:</span> {offer.destAddress}</p>
              <p className="text-cg-warning">{offer.terrainType.includes("RIPIO") ? "⚠ Ripio compactado" : "Asfalto"} {offer.requires4x4 ? "· Requiere 4x4" : ""}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={declineOffer} className="flex-1 bg-slate-700 rounded-xl py-3 font-semibold">
                Rechazar
              </button>
              <button onClick={acceptOffer} className="flex-1 bg-cg-accent text-black rounded-xl py-3 font-bold">
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveTripCard({
  trip,
  pinInput,
  setPinInput,
  onVerify,
  onComplete,
  onCancel,
}: {
  trip: any;
  pinInput: string;
  setPinInput: (v: string) => void;
  onVerify: () => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const canCancel = trip.status === "ACCEPTED" || trip.status === "DRIVER_ARRIVED";
  return (
    <div className="bg-cg-darkSurface rounded-2xl p-4 mb-4">
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Viaje activo · {trip.status}</p>
      <p className="font-semibold mb-1">{trip.originAddress} → {trip.destAddress}</p>
      <p className="text-cg-earningsBright font-bold mb-3">{formatClp(trip.driverNetClp)}</p>

      {canCancel ? (
        <div className="flex gap-2 mb-2">
          <input
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            placeholder="PIN del pasajero"
            className="flex-1 bg-cg-darkSurfaceAlt rounded-xl px-4 py-3 text-sm tracking-widest"
            maxLength={4}
          />
          <button onClick={onVerify} className="bg-cg-accent text-black font-bold rounded-xl px-4">
            Iniciar viaje
          </button>
        </div>
      ) : (
        <button onClick={onComplete} className="w-full bg-cg-accent text-black font-bold rounded-xl py-3 mb-2">
          Finalizar viaje
        </button>
      )}

      {canCancel && (
        <button onClick={onCancel} className="w-full text-center text-cg-danger text-xs font-semibold py-1">
          Cancelar viaje (aplica penalidad)
        </button>
      )}
    </div>
  );
}

function EarningsRow({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className={`font-semibold ${negative ? "text-cg-danger" : "text-cg-earningsBright"}`}>
        {negative ? "-" : ""}
        {formatClp(Math.abs(value))}
      </span>
    </div>
  );
}
