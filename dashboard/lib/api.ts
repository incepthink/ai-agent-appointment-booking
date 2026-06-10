import type { Appointment, Clinic, Doctor, MetricsSummary, SlotsResponse } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const TOKEN_KEY = "clinic_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  alternatives?: { start_iso: string; label: string }[];
  status: number;
  constructor(message: string, status: number, alternatives?: { start_iso: string; label: string }[]) {
    super(message);
    this.status = status;
    this.alternatives = alternatives;
  }
}

async function request<T>(path: string, options: RequestInit = {}, auth = true): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) },
  });

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
  }

  if (!res.ok) {
    const b = body as { error?: string; alternatives?: { start_iso: string; label: string }[] };
    if (res.status === 401 && typeof window !== "undefined") {
      // A stale/expired token cascades: once cleared, every later call is sent
      // without a Bearer header and the backend replies "Missing or malformed
      // Authorization header." Bounce to login so the user re-authenticates
      // instead of getting stuck on those errors.
      clearToken();
      if (window.location.pathname !== "/login") window.location.replace("/login");
    }
    throw new ApiError(b?.error ?? `Request failed (${res.status})`, res.status, b?.alternatives);
  }
  return body as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; doctor: Doctor; clinic: Clinic }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
      false,
    ),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  getClinic: () => request<{ clinic: Clinic }>("/clinic"),

  updateClinic: (fields: Partial<Omit<Clinic, "id" | "code" | "email">>) =>
    request<{ clinic: Clinic }>("/clinic", { method: "PUT", body: JSON.stringify(fields) }),

  // The logged-in doctor's own profile + working hours.
  getMe: () => request<{ doctor: Doctor }>("/me"),

  updateMe: (fields: Partial<Pick<Doctor, "name" | "specialty" | "bio" | "open" | "close" | "days" | "slotMinutes">>) =>
    request<{ doctor: Doctor }>("/me", { method: "PUT", body: JSON.stringify(fields) }),

  // All doctors at the clinic (roster) — powers the filter + booking picker.
  listDoctors: () => request<{ doctors: Doctor[] }>("/doctors"),

  listAppointments: (params: { from?: string; to?: string; status?: string; doctorId?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    if (params.status) q.set("status", params.status);
    if (params.doctorId !== undefined) q.set("doctor_id", String(params.doctorId));
    const qs = q.toString();
    return request<{ appointments: Appointment[] }>(`/appointments${qs ? `?${qs}` : ""}`);
  },

  createAppointment: (input: { patient_name: string; phone: string; start_iso: string; reason?: string; doctor_id: number }) =>
    request<{ appointment: Appointment }>("/appointments", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  reschedule: (id: number, newStartIso: string) =>
    request<{ appointment: Appointment }>(`/appointments/${id}/reschedule`, {
      method: "PATCH",
      body: JSON.stringify({ new_start_iso: newStartIso }),
    }),

  cancel: (id: number) =>
    request<{ appointment: Appointment }>(`/appointments/${id}/cancel`, { method: "PATCH" }),

  getSlots: (date: string, doctorId: number) =>
    request<SlotsResponse>(`/slots?date=${date}&doctor_id=${doctorId}`),

  // Agent response-time metrics for the Insights page. days: number of days, or
  // "all" for all-time.
  getMetrics: (days: number | "all" = 7) =>
    request<MetricsSummary>(`/metrics?days=${days}`),

  // SSE stream URL for live appointment updates. EventSource can't send an
  // Authorization header, so the token rides as a query param. Returns null
  // when there is no token (caller should skip subscribing).
  appointmentsStreamUrl: (): string | null => {
    const token = getToken();
    return token ? `${BASE}/appointments/stream?token=${encodeURIComponent(token)}` : null;
  },
};
