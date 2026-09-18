import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setSession, AuthUser } from "../lib/api";

const ROLE_HOME: Record<string, string> = {
  PASSENGER: "/pasajero",
  DRIVER: "/conductor",
  ADMIN: "/admin",
  DISPATCHER: "/admin",
};

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("cabrasgo2025");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoUsers, setDemoUsers] = useState<{ email: string; firstName: string; lastName: string; role: string }[]>([]);

  useEffect(() => {
    api
      .get<{ password: string; users: typeof demoUsers }>("/auth/demo-accounts")
      .then((d) => setDemoUsers(d.users))
      .catch(() => {});
  }, []);

  async function doLogin(loginEmail: string) {
    setLoading(true);
    setError("");
    try {
      const res = await api.post<{ token: string; user: AuthUser }>("/auth/login", {
        email: loginEmail,
        password,
      });
      setSession(res.token, res.user);
      navigate(ROLE_HOME[res.user.role] || "/");
    } catch (e: any) {
      setError(e.message || "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-cg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-cg-surface rounded-2xl shadow-xl p-8">
        <div className="flex flex-col items-center mb-6">
          <img src="/logo.png" alt="CabrasGo" className="w-16 h-16 rounded-2xl mb-3" />
          <h1 className="text-2xl font-bold text-cg-primary">CabrasGo</h1>
          <p className="text-sm text-slate-500 text-center mt-1">
            Movilidad para Las Cabras, Peumo y la cuenca del Lago Rapel
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            doLogin(email);
          }}
          className="space-y-3"
        >
          <input
            type="email"
            required
            placeholder="correo@ejemplo.cl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cg-accent"
          />
          <input
            type="password"
            required
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cg-accent"
          />
          {error && <p className="text-cg-danger text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-cg-accent text-white font-semibold rounded-xl py-3 hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>

        <div className="mt-6">
          <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Cuentas demo (contraseña: cabrasgo2025)</p>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {demoUsers.map((u) => (
              <button
                key={u.email}
                onClick={() => {
                  setEmail(u.email);
                  doLogin(u.email);
                }}
                className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg bg-cg-surfaceAlt hover:bg-slate-200 text-sm"
              >
                <span>
                  {u.firstName} {u.lastName}
                </span>
                <span className="text-[10px] font-semibold text-cg-accent">{u.role}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
