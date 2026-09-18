import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getUser, clearSession } from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { formatClp, formatPatente } from "../../lib/format";
import { LiveMap } from "../../components/LiveMap";

interface Landmark {
  code: string;
  name: string;
  lat: number;
  lng: number;
  note: string;
}

interface QuoteCategory {
  category: "STANDARD_SEDAN" | "RURAL_4X4_XL";
  etaMinutes: number;
  totalFareClp: number;
  recommended: boolean;
}

interface Quote {
  distanceTotalKm: number;
  distanceDirtKm: number;
  categories: QuoteCategory[];
  geofenceZoneName: string | null;
  dynamicMultiplier: number;
  fuelPriceClp: number;
}

type Screen = "home" | "categories" | "dispatching" | "tracking" | "payment" | "rating" | "done";

const CATEGORY_LABEL: Record<string, string> = {
  STANDARD_SEDAN: "CabrasGo Estándar",
  RURAL_4X4_XL: "CabrasGo Rural 4x4",
};

const FEEDBACK_TAGS = [
  "Conducción segura en caminos de tierra",
  "Auto limpio y fresco",
  "Puntualidad",
  "Muy amable",
];

export function PasajeroApp() {
  const navigate = useNavigate();
  const user = getUser();
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [quickAccess, setQuickAccess] = useState<Landmark[]>([]);
  const [origin, setOrigin] = useState<Landmark | null>(null);
  const [destination, setDestination] = useState<Landmark | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [selectedCategory, setSelectedCategory] = useState<QuoteCategory | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [pin, setPin] = useState<string>("");
  const [live, setLive] = useState<any>(null);
  const [error, setError] = useState("");
  const [payMethod, setPayMethod] = useState<"WEBPAY_ONECLICK" | "CUENTARUT_BANCOESTADO" | "CASH">("WEBPAY_ONECLICK");
  const [score, setScore] = useState(5);
  const [tags, setTags] = useState<string[]>([]);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user || user.role !== "PASSENGER") {
      navigate("/");
      return;
    }
    api
      .get<{ landmarks: Landmark[]; quickAccess: Landmark[]; defaultOrigin: Landmark }>("/passenger/landmarks")
      .then((d) => {
        setLandmarks(d.landmarks);
        setQuickAccess(d.quickAccess);
        setOrigin(d.defaultOrigin);
      });
  }, []);

  useEffect(() => {
    if (!tripId || screen !== "tracking") return;
    const socket = getSocket();
    socket.emit("join:trip", tripId);
    const onPos = (payload: any) => {
      if (payload.tripId === tripId) setLive((l: any) => ({ ...l, ...payload }));
    };
    const onStatus = (payload: any) => {
      if (payload.tripId === tripId) setLive((l: any) => ({ ...l, status: payload.status }));
    };
    socket.on("trip:live_position", onPos);
    socket.on("trip:status", onStatus);

    const interval = window.setInterval(refreshLive, 2500);
    pollRef.current = interval;
    return () => {
      socket.off("trip:live_position", onPos);
      socket.off("trip:status", onStatus);
      window.clearInterval(interval);
    };
  }, [tripId, screen]);

  async function refreshLive() {
    if (!tripId) return;
    try {
      const data = await api.get<any>(`/passenger/trips/${tripId}/live`);
      setLive((l: any) => ({ ...data, status: l?.status || data.status }));
      if (data.status === "IN_PROGRESS" || data.status === "DRIVER_ARRIVED" || data.status === "ACCEPTED") {
        setScreen("tracking");
      }
      if (data.paymentStatus === "CAPTURED" || data.paymentStatus === "AUTHORIZED") {
        // stays on tracking until trip completed
      }
    } catch {
      /* ignore transient errors while polling */
    }
  }

  async function getQuote(dest: Landmark) {
    setDestination(dest);
    setError("");
    if (!origin) return;
    try {
      const q = await api.post<Quote>("/passenger/quote", {
        origin: { lat: origin.lat, lng: origin.lng, address: origin.name },
        destination: { lat: dest.lat, lng: dest.lng, address: dest.name },
      });
      setQuote(q);
      setScreen("categories");
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function requestTrip() {
    if (!origin || !destination || !selectedCategory) return;
    setScreen("dispatching");
    try {
      const res = await api.post<{ tripId: string; pin: string }>("/passenger/trips/request", {
        origin: { lat: origin.lat, lng: origin.lng, address: origin.name },
        destination: { lat: destination.lat, lng: destination.lng, address: destination.name },
        category: selectedCategory.category,
        paymentMethod: payMethod,
      });
      setTripId(res.tripId);
      setPin(res.pin);
      pollUntilAccepted(res.tripId);
    } catch (e: any) {
      setError(e.message);
      setScreen("categories");
    }
  }

  async function pollUntilAccepted(id: string) {
    const timer = window.setInterval(async () => {
      try {
        const data = await api.get<any>(`/passenger/trips/${id}/live`);
        setLive(data);
        if (data.status && data.status !== "DISPATCHING") {
          window.clearInterval(timer);
          setScreen("tracking");
        }
      } catch {
        /* ignore */
      }
    }, 2000);
  }

  async function pay() {
    if (!tripId) return;
    await api.post(`/passenger/trips/${tripId}/pay`, { method: payMethod });
    setScreen("rating");
  }

  async function submitRating() {
    if (!tripId) return;
    await api.post(`/passenger/trips/${tripId}/rate`, { score, feedbackTags: tags, tipClp: 0 });
    setScreen("done");
  }

  function resetTrip() {
    setTripId(null);
    setQuote(null);
    setDestination(null);
    setSelectedCategory(null);
    setLive(null);
    setScreen("home");
  }

  function logout() {
    clearSession();
    navigate("/");
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-cg-bg text-cg-primary">
      <header className="flex items-center justify-between px-4 py-3 bg-cg-surface shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <img src="/logo.png" className="w-8 h-8 rounded-lg" />
          <span className="font-bold">CabrasGo</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500">{user.firstName}</span>
          <button onClick={logout} className="text-cg-danger font-medium">
            Salir
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4">
        {error && <div className="mb-3 text-sm text-cg-danger bg-red-50 rounded-lg p-2">{error}</div>}

        {screen === "home" && (
          <HomeScreen
            origin={origin}
            landmarks={landmarks}
            quickAccess={quickAccess}
            onPick={getQuote}
          />
        )}

        {screen === "categories" && quote && destination && (
          <CategoriesScreen
            quote={quote}
            destination={destination}
            payMethod={payMethod}
            setPayMethod={setPayMethod}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
            onConfirm={requestTrip}
            onBack={() => setScreen("home")}
          />
        )}

        {screen === "dispatching" && (
          <div className="text-center py-16">
            <div className="animate-spin h-12 w-12 border-4 border-cg-accent border-t-transparent rounded-full mx-auto mb-4" />
            <p className="font-semibold">Buscando conductor cercano...</p>
            <p className="text-sm text-slate-500 mt-1">PIN de verificación: <b>{pin}</b></p>
          </div>
        )}

        {screen === "tracking" && live && (
          <TrackingScreen live={live} pin={pin} onPay={() => setScreen("payment")} />
        )}

        {screen === "payment" && (
          <PaymentScreen
            fare={live?.fareGrossClp ?? 0}
            payMethod={payMethod}
            setPayMethod={setPayMethod}
            onConfirm={pay}
          />
        )}

        {screen === "rating" && (
          <RatingScreen score={score} setScore={setScore} tags={tags} setTags={setTags} onSubmit={submitRating} />
        )}

        {screen === "done" && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🐐</div>
            <p className="text-xl font-bold mb-2">¡Gracias por viajar con CabrasGo!</p>
            <button onClick={resetTrip} className="mt-4 bg-cg-accent text-white rounded-xl px-6 py-3 font-semibold">
              Pedir otro viaje
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function HomeScreen({
  origin,
  landmarks,
  quickAccess,
  onPick,
}: {
  origin: Landmark | null;
  landmarks: Landmark[];
  quickAccess: Landmark[];
  onPick: (l: Landmark) => void;
}) {
  return (
    <div>
      <div className="mb-4">
        <LiveMap
          center={origin ? [origin.lat, origin.lng] : [-34.2917, -71.3092]}
          markers={origin ? [{ id: origin.code, lat: origin.lat, lng: origin.lng, label: origin.name }] : []}
          height={180}
        />
      </div>
      <div className="bg-cg-surface rounded-2xl p-4 mb-4 shadow-sm">
        <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Tu ubicación</p>
        <p className="font-semibold">{origin?.name ?? "Cargando..."}</p>
      </div>

      <p className="text-sm font-semibold text-slate-600 mb-2">Destinos frecuentes</p>
      <div className="grid grid-cols-2 gap-2 mb-6">
        {quickAccess.map((l) => (
          <button
            key={l.code}
            onClick={() => onPick(l)}
            className="bg-cg-surface rounded-xl p-3 text-left shadow-sm hover:shadow-md transition"
          >
            <p className="text-sm font-semibold truncate">{l.name}</p>
            <p className="text-xs text-slate-400 truncate">{l.note}</p>
          </button>
        ))}
      </div>

      <p className="text-sm font-semibold text-slate-600 mb-2">¿A dónde vamos?</p>
      <div className="space-y-2">
        {landmarks
          .filter((l) => l.code !== origin?.code)
          .map((l) => (
            <button
              key={l.code}
              onClick={() => onPick(l)}
              className="w-full flex items-center justify-between bg-cg-surface rounded-xl px-4 py-3 shadow-sm hover:bg-cg-surfaceAlt"
            >
              <span className="text-sm">{l.name}</span>
              <span className="text-cg-accent text-xs font-semibold">Cotizar</span>
            </button>
          ))}
      </div>
    </div>
  );
}

function CategoriesScreen({
  quote,
  destination,
  payMethod,
  setPayMethod,
  selected,
  onSelect,
  onConfirm,
  onBack,
}: {
  quote: Quote;
  destination: Landmark;
  payMethod: string;
  setPayMethod: (m: any) => void;
  selected: QuoteCategory | null;
  onSelect: (c: QuoteCategory) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <button onClick={onBack} className="text-sm text-slate-500 mb-3">
        ← Cambiar destino
      </button>
      <div className="bg-cg-surface rounded-2xl p-4 mb-4 shadow-sm">
        <p className="text-sm text-slate-500">Destino</p>
        <p className="font-semibold">{destination.name}</p>
        <p className="text-xs text-slate-400 mt-1">
          {quote.distanceTotalKm} km · {quote.distanceDirtKm} km ripio
          {quote.geofenceZoneName ? ` · Zona ${quote.geofenceZoneName}` : ""}
          {quote.dynamicMultiplier !== 1 ? ` · Tarifa dinámica x${quote.dynamicMultiplier}` : ""}
        </p>
      </div>

      <div className="space-y-3 mb-4">
        {quote.categories.map((c) => (
          <button
            key={c.category}
            onClick={() => onSelect(c)}
            className={`w-full flex items-center justify-between rounded-xl p-4 border-2 transition ${
              selected?.category === c.category ? "border-cg-accent bg-emerald-50" : "border-transparent bg-cg-surface"
            } shadow-sm`}
          >
            <div className="text-left">
              <p className="font-semibold">{CATEGORY_LABEL[c.category]}</p>
              <p className="text-xs text-slate-400">ETA {c.etaMinutes} min {c.recommended ? "· Recomendado (4x4)" : ""}</p>
            </div>
            <span className="font-bold text-lg">{formatClp(c.totalFareClp)}</span>
          </button>
        ))}
      </div>

      <p className="text-sm font-semibold text-slate-600 mb-2">Método de pago</p>
      <div className="grid grid-cols-3 gap-2 mb-6">
        {(["WEBPAY_ONECLICK", "CUENTARUT_BANCOESTADO", "CASH"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setPayMethod(m)}
            className={`rounded-xl py-2 text-xs font-semibold ${
              payMethod === m ? "bg-cg-primary text-white" : "bg-cg-surfaceAlt text-slate-600"
            }`}
          >
            {m === "WEBPAY_ONECLICK" ? "Webpay" : m === "CUENTARUT_BANCOESTADO" ? "CuentaRUT" : "Efectivo"}
          </button>
        ))}
      </div>

      <button
        disabled={!selected}
        onClick={onConfirm}
        className="w-full bg-cg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-40"
      >
        Confirmar viaje
      </button>
    </div>
  );
}

function TrackingScreen({ live, pin, onPay }: { live: any; pin: string; onPay: () => void }) {
  const status = live.status;
  const statusLabel: Record<string, string> = {
    ACCEPTED: "Conductor en camino",
    DRIVER_ARRIVED: "¡Tu conductor llegó!",
    IN_PROGRESS: "Viaje en curso",
    COMPLETED: "Viaje completado",
  };
  return (
    <div>
      <div className="bg-cg-primary text-white rounded-2xl p-4 mb-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide opacity-70">Estado</p>
        <p className="text-lg font-bold">{statusLabel[status] ?? status}</p>
      </div>

      <div className="mb-4 shadow-sm">
        <LiveMap
          center={[live.live?.lat ?? live.origin.lat, live.live?.lng ?? live.origin.lng]}
          markers={[
            { id: "origin", lat: live.origin.lat, lng: live.origin.lng, label: "Origen", sub: live.origin.address },
            { id: "dest", lat: live.destination.lat, lng: live.destination.lng, label: "Destino", sub: live.destination.address },
            ...(live.live
              ? [{ id: "car", lat: live.live.lat, lng: live.live.lng, label: live.driver?.name ?? "Conductor", kind: "car" as const }]
              : []),
          ]}
        />
      </div>

      {live.driver && (
        <div className="bg-cg-surface rounded-2xl p-4 mb-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="font-semibold">{live.driver.name}</p>
            <p className="text-xs text-slate-400">{live.driver.model} · {formatPatente(live.driver.plate)}</p>
            <p className="text-xs text-slate-400">⭐ {Number(live.driver.rating).toFixed(1)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">PIN</p>
            <p className="text-2xl font-bold tracking-widest">{pin}</p>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <a
          href={`https://wa.me/?text=${encodeURIComponent("Voy en camino con CabrasGo, sigue mi viaje.")}`}
          target="_blank"
          rel="noreferrer"
          className="flex-1 text-center bg-cg-surfaceAlt rounded-xl py-3 text-sm font-semibold"
        >
          Compartir viaje
        </a>
        <a href={`tel:${live.sosPhone}`} className="flex-1 text-center bg-cg-danger text-white rounded-xl py-3 text-sm font-semibold">
          SOS · 133
        </a>
      </div>

      {status === "IN_PROGRESS" && (
        <button onClick={onPay} className="w-full bg-cg-accent text-white font-semibold rounded-xl py-3">
          Finalizar y pagar
        </button>
      )}
    </div>
  );
}

function PaymentScreen({
  fare,
  payMethod,
  setPayMethod,
  onConfirm,
}: {
  fare: number;
  payMethod: string;
  setPayMethod: (m: any) => void;
  onConfirm: () => void;
}) {
  return (
    <div>
      <div className="bg-cg-surface rounded-2xl p-6 mb-4 shadow-sm text-center">
        <p className="text-sm text-slate-500">Total del viaje</p>
        <p className="text-3xl font-bold">{formatClp(fare)}</p>
      </div>
      <div className="space-y-2 mb-6">
        {(["WEBPAY_ONECLICK", "CUENTARUT_BANCOESTADO", "CASH"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setPayMethod(m)}
            className={`w-full flex items-center justify-between rounded-xl px-4 py-3 ${
              payMethod === m ? "bg-cg-primary text-white" : "bg-cg-surface shadow-sm"
            }`}
          >
            <span>{m === "WEBPAY_ONECLICK" ? "Webpay Oneclick (Transbank)" : m === "CUENTARUT_BANCOESTADO" ? "CuentaRUT BancoEstado" : "Efectivo al conductor"}</span>
          </button>
        ))}
      </div>
      <button onClick={onConfirm} className="w-full bg-cg-accent text-white font-semibold rounded-xl py-3">
        Pagar {formatClp(fare)}
      </button>
    </div>
  );
}

function RatingScreen({
  score,
  setScore,
  tags,
  setTags,
  onSubmit,
}: {
  score: number;
  setScore: (n: number) => void;
  tags: string[];
  setTags: (t: string[]) => void;
  onSubmit: () => void;
}) {
  function toggleTag(t: string) {
    setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]);
  }
  return (
    <div className="text-center">
      <p className="text-lg font-bold mb-4">¿Cómo estuvo tu viaje?</p>
      <div className="flex justify-center gap-2 mb-6 text-3xl">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setScore(n)} className={n <= score ? "text-cg-warning" : "text-slate-300"}>
            ★
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 justify-center mb-6">
        {FEEDBACK_TAGS.map((t) => (
          <button
            key={t}
            onClick={() => toggleTag(t)}
            className={`text-xs rounded-full px-3 py-2 ${tags.includes(t) ? "bg-cg-accent text-white" : "bg-cg-surfaceAlt"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <button onClick={onSubmit} className="w-full bg-cg-accent text-white font-semibold rounded-xl py-3">
        Enviar calificación
      </button>
    </div>
  );
}
