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
