export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Day = (typeof DAYS)[number];

export type Clinic = {
  id: number;
  code: string;
  name: string;
  tz: string;
  open: string;
  close: string;
  days: Day[];
  slotMinutes: number;
  email: string | null;
  address: string | null;
  contactPhone: string | null;
  description: string | null;
};

// A doctor at the clinic. The roster (/doctors) omits email; /me includes it.
export type Doctor = {
  id: number;
  code: string;
  name: string;
  specialty: string;
  qualification: string;
  bio: string | null;
  open: string;
  close: string;
  days: Day[];
  slotMinutes: number;
  email?: string | null;
};

export type Appointment = {
  id: number;
  patient_name: string;
  phone: string;
  start_iso: string;
  end_iso: string;
  label: string;
  reason: string | null;
  status: "booked" | "cancelled";
  doctor_id: number | null;
  doctor_name: string | null;
  created_at: string;
};

export type Slot = { start_iso: string; label: string };

export type SlotsResponse = {
  date: string;
  open: boolean;
  slots: Slot[];
  message?: string;
};

// --- Agent response-time metrics (Insights page) ---

// A timing distribution for one measurement, all values in milliseconds.
export type Stat = { avg: number; p50: number; p95: number; max: number };

export type MetricsSummary = {
  window_days: number | null; // null = all time
  count: number;
  total: Stat; // patient-perceived response time (headline)
  handle: Stat; // agent processing
  llm: Stat; // time inside OpenAI calls
  send: Stat; // WhatsApp send
  avg_llm_calls: number;
  avg_tool_calls: number;
  avg_prompt_tokens: number;
  avg_completion_tokens: number;
  avg_cached_tokens: number;
  conversations: number; // distinct patients the agent talked to in the window
  bookings: number; // appointments created in the window
  est_cost_usd: number; // estimated OpenAI spend for the window
};

export const COMMON_TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];
