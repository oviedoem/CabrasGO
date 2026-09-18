const BASE = "/api/v1";

export interface AuthUser {
  id: string;
  rut: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: "PASSENGER" | "DRIVER" | "ADMIN" | "DISPATCHER";
  ratingAvg: string | number;
  driverId: string | null;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem("cabrasgo_token");
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser) {
  try {
    localStorage.setItem("cabrasgo_token", token);
    localStorage.setItem("cabrasgo_user", JSON.stringify(user));
  } catch {
    /* private browsing / blocked storage: session lives only for this tab */
  }
}

export function getUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("cabrasgo_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem("cabrasgo_token");
    localStorage.removeItem("cabrasgo_user");
  } catch {
    /* ignore */
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any).error || `Error ${res.status}`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
};
