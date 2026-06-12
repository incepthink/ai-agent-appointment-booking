import { DateTime, Settings } from "luxon";
import { db } from "../src/db";
import { getClinicByCode } from "../src/clinics";
import { getDoctorByCode } from "../src/doctors";

// A fixed "now" used across the deterministic suites. 2026-06-15 is a MONDAY,
// 07:00 in Asia/Kolkata — before every IST clinic opens, so "today" slots are
// all still in the future. Chosen so the seeded LOTUS doctors give predictable
// availability:
//   LOTUS-RAO   (GP, 09:00-17:00 Mon-Sat) -> open Mon  -> 16 slots
//   LOTUS-IYER  (Paeds, 09:00-13:00 Mon-Fri) -> open Mon -> 8 slots
//   LOTUS-MEHTA (Derm, 11:00-19:00 Tue-Sat) -> CLOSED Mon, open Tue
export const ANCHOR_ZONE = "Asia/Kolkata";
export const ANCHOR_ISO = "2026-06-15T07:00:00"; // Monday 07:00 IST
export const MONDAY = "2026-06-15";
export const TUESDAY = "2026-06-16";
export const SUNDAY = "2026-06-14"; // every seeded clinic is closed Sunday

// Freeze Luxon's clock to a fixed instant. Returns a restore fn; pair with
// afterEach(restore) or call the returned function manually.
export function freezeNow(iso: string = ANCHOR_ISO, zone: string = ANCHOR_ZONE): () => void {
  const millis = DateTime.fromISO(iso, { zone }).toMillis();
  const prev = Settings.now;
  Settings.now = () => millis;
  return () => {
    Settings.now = prev;
  };
}

// Seeded fixtures (db.ts seeds these on a fresh DB). Throw if missing so a
// broken fixture fails loudly instead of returning undefined into a test.
export function lotus() {
  const c = getClinicByCode("LOTUS");
  if (!c) throw new Error("seed fixture LOTUS clinic missing");
  return c;
}
export function doctor(code: string) {
  const d = getDoctorByCode(code);
  if (!d) throw new Error(`seed fixture doctor ${code} missing`);
  return d;
}

// Per-test cleanup: wipe the dynamic tables but keep the seeded clinics/doctors.
// Call in beforeEach so tests in the same file don't leak state into each other.
export function resetDynamicData(): void {
  db.exec(`
    DELETE FROM appointments;
    DELETE FROM conversations;
    DELETE FROM sessions;
    DELETE FROM message_metrics;
  `);
}

// Insert a booked appointment directly (bypassing the agent) to set up a clash.
export function seedBooking(opts: {
  doctorId: number;
  clinicId: number;
  phone: string;
  name: string;
  startUtc: string;
  endUtc: string;
}): number {
  const r = db
    .prepare(
      `INSERT INTO appointments (patient_name, phone, start_utc, end_utc, reason, clinic_id, doctor_id)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(opts.name, opts.phone, opts.startUtc, opts.endUtc, opts.clinicId, opts.doctorId);
  return Number(r.lastInsertRowid);
}
