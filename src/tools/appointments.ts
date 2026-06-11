import { db, type AppointmentRow } from "../db";
import { getClinic, type Clinic } from "../clinics";
import { getDoctor, type Doctor } from "../doctors";
import { emitAppointmentsChanged } from "../events";
import { userTextSinceLastBooking } from "../session";
import { checkSlotAvailable } from "./slots";
import {
  endOfSlot,
  humanLocal,
  nowInClinicTz,
  parseIsoToClinic,
  toUtcIso,
} from "./time";

export type ToolContext = { phone: string; clinic: Clinic };

// The model occasionally fabricates a filler name (or passes a relationship
// word) to satisfy the required patient_name parameter instead of asking the
// sender. Prompt rules alone haven't stopped this, so reject those values here
// and bounce an instruction back to the model.
const PLACEHOLDER_NAMES = new Set([
  // generic fillers the model reaches for
  "patient", "the patient", "patient name", "unknown", "name", "no name",
  "n a", "na", "tbd", "test", "user", "customer", "guest", "client", // "n a" = "N/A" after normalization
  "anonymous", "someone", "me", "myself",
  // relationship words (mirrors the prompt rule)
  "grandmother", "grandma", "granny", "grandfather", "grandpa",
  "mother", "mom", "mum", "father", "dad", "son", "daughter",
  "wife", "husband", "brother", "sister", "uncle", "aunt", "aunty",
  "cousin", "nephew", "niece", "friend",
]);

// Exact full-string match after normalization, so real names that merely
// contain a blocked word ("Patience", "Sonia") are never rejected.
function isPlaceholderName(name: string): boolean {
  const norm = name.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (PLACEHOLDER_NAMES.has(norm)) return true;
  if (norm.startsWith("my ") && PLACEHOLDER_NAMES.has(norm.slice(3))) return true;
  return false;
}

// A real name like "Zoe" passes isPlaceholderName, so it can't catch a name the
// model carried over from an EARLIER booking instead of asking. Require at least
// one substantial token of the name to appear in the sender's own messages for
// THIS booking. Loose on purpose: a surname the model adds is fine; a wholesale
// carried-over name (no token of which the sender typed this booking) is rejected.
function nameIsGrounded(name: string, userText: string): boolean {
  const haystack = userText.toLowerCase();
  const tokens = (name.toLowerCase().match(/[a-z]+/g) ?? []).filter((t) => t.length >= 2);
  if (tokens.length === 0) return false;
  return tokens.some((t) => haystack.includes(t));
}

type BookedAppointment = {
  id: number;
  start_iso: string;
  label: string;
  clinic_name: string;
  clinic_code: string;
  doctor_name: string;
  doctor_code: string;
};

export function createAppointment(
  ctx: ToolContext,
  doctor: Doctor,
  args: { patient_name: string; start_iso: string; reason?: string },
): { ok: boolean; appointment?: BookedAppointment; error?: string; alternatives?: { start_iso: string; label: string }[] } {
  const name = args.patient_name?.trim();
  if (!name) return { ok: false, error: "patient_name is required." };
  if (isPlaceholderName(name)) {
    return {
      ok: false,
      error: `"${name}" is not the patient's real name. Ask the sender for the actual name of the person who will see the doctor, then call create_appointment again. Never book with a placeholder.`,
    };
  }
  if (!nameIsGrounded(name, userTextSinceLastBooking(ctx.phone))) {
    return {
      ok: false,
      error: `"${name}" was not provided by the sender for this booking — do not carry a name over from a previous appointment. Ask the sender for the patient's name for THIS appointment, then call create_appointment again.`,
    };
  }

  const check = checkSlotAvailable(doctor, { start_iso: args.start_iso });
  if (!check.available) {
    return { ok: false, error: check.reason ?? "Unavailable.", alternatives: check.alternatives };
  }

  const start = parseIsoToClinic(args.start_iso, doctor);
  const startUtc = toUtcIso(start);
  const endUtc = toUtcIso(endOfSlot(start, doctor));

  try {
    const result = db
      .prepare(
        `INSERT INTO appointments (patient_name, phone, start_utc, end_utc, reason, clinic_id, doctor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(name, ctx.phone, startUtc, endUtc, args.reason ?? null, ctx.clinic.id, doctor.id);
    emitAppointmentsChanged(ctx.clinic.id);
    return {
      ok: true,
      appointment: {
        id: Number(result.lastInsertRowid),
        start_iso: startUtc,
        label: humanLocal(start, doctor),
        clinic_name: ctx.clinic.name,
        clinic_code: ctx.clinic.code,
        doctor_name: doctor.name,
        doctor_code: doctor.code,
      },
    };
  } catch (e: any) {
    // partial unique-index violation = race condition
    if (String(e?.message ?? "").includes("UNIQUE")) {
      const alt = checkSlotAvailable(doctor, { start_iso: args.start_iso });
      return { ok: false, error: "Slot was just taken.", alternatives: alt.alternatives };
    }
    throw e;
  }
}

export function findAppointments(ctx: ToolContext): {
  upcoming: {
    id: number;
    start_iso: string;
    label: string;
    patient_name: string;
    reason: string | null;
    clinic_name: string;
    clinic_code: string;
    doctor_name: string | null;
  }[];
} {
  // "Now" is an absolute instant; any clinic's clock yields the same UTC cutoff.
  const nowUtc = toUtcIso(nowInClinicTz(ctx.clinic));
  const rows = db
    .prepare(
      `SELECT * FROM appointments
       WHERE phone = ? AND status = 'booked' AND start_utc >= ?
       ORDER BY start_utc ASC`,
    )
    .all(ctx.phone, nowUtc) as AppointmentRow[];

  const upcoming = [];
  for (const r of rows) {
    // Label each appointment in its own clinic's timezone; name its doctor.
    const rowClinic = getClinic(r.clinic_id) ?? ctx.clinic;
    const rowDoctor = getDoctor(r.doctor_id);
    upcoming.push({
      id: r.id,
      start_iso: r.start_utc,
      label: humanLocal(parseIsoToClinic(r.start_utc, rowClinic), rowClinic),
      patient_name: r.patient_name,
      reason: r.reason,
      clinic_name: rowClinic.name,
      clinic_code: rowClinic.code,
      doctor_name: rowDoctor?.name ?? null,
    });
  }
  return { upcoming };
}

// Resolve a patient's appointment by id, regardless of which clinic is active —
// listings are cross-clinic, so the chosen id may belong to another clinic.
function ownAppointment(ctx: ToolContext, id: number): AppointmentRow | null {
  const row = db
    .prepare(`SELECT * FROM appointments WHERE id = ? AND phone = ?`)
    .get(id, ctx.phone) as AppointmentRow | undefined;
  return row ?? null;
}

export function rescheduleAppointment(
  ctx: ToolContext,
  args: { appointment_id: number; new_start_iso: string },
): { ok: boolean; appointment?: BookedAppointment; error?: string; alternatives?: { start_iso: string; label: string }[] } {
  const row = ownAppointment(ctx, args.appointment_id);
  if (!row) return { ok: false, error: "Appointment not found for your number." };
  if (row.status !== "booked") return { ok: false, error: "Appointment is not active." };

  // Validate against the appointment's own doctor, not whichever is active.
  const doctor = getDoctor(row.doctor_id);
  if (!doctor) return { ok: false, error: "Appointment's doctor is unavailable." };
  const clinic = getClinic(row.clinic_id) ?? ctx.clinic;
  const check = checkSlotAvailable(doctor, { start_iso: args.new_start_iso });
  if (!check.available) {
    return { ok: false, error: check.reason ?? "Unavailable.", alternatives: check.alternatives };
  }
  const start = parseIsoToClinic(args.new_start_iso, doctor);
  const startUtc = toUtcIso(start);
  const endUtc = toUtcIso(endOfSlot(start, doctor));

  try {
    db.prepare(
      `UPDATE appointments SET start_utc = ?, end_utc = ? WHERE id = ?`,
    ).run(startUtc, endUtc, row.id);
    emitAppointmentsChanged(clinic.id);
    return {
      ok: true,
      appointment: {
        id: row.id,
        start_iso: startUtc,
        label: humanLocal(start, doctor),
        clinic_name: clinic.name,
        clinic_code: clinic.code,
        doctor_name: doctor.name,
        doctor_code: doctor.code,
      },
    };
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      const alt = checkSlotAvailable(doctor, { start_iso: args.new_start_iso });
      return { ok: false, error: "Slot was just taken.", alternatives: alt.alternatives };
    }
    throw e;
  }
}

export function cancelAppointment(
  ctx: ToolContext,
  args: { appointment_id: number },
): { ok: boolean; error?: string; clinic_name?: string; clinic_code?: string } {
  const row = ownAppointment(ctx, args.appointment_id);
  if (!row) return { ok: false, error: "Appointment not found for your number." };
  if (row.status !== "booked") return { ok: false, error: "Already cancelled." };
  db.prepare(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`).run(row.id);
  emitAppointmentsChanged(row.clinic_id);
  const clinic = getClinic(row.clinic_id) ?? ctx.clinic;
  return { ok: true, clinic_name: clinic.name, clinic_code: clinic.code };
}
