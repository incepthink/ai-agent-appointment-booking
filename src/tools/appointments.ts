import { db, type AppointmentRow } from "../db";
import { getClinic, type Clinic } from "../clinics";
import { checkSlotAvailable } from "./slots";
import {
  endOfSlot,
  humanLocal,
  nowInClinicTz,
  parseIsoToClinic,
  toUtcIso,
} from "./time";

export type ToolContext = { phone: string; clinic: Clinic };

export function createAppointment(
  ctx: ToolContext,
  args: { patient_name: string; start_iso: string; reason?: string },
): { ok: boolean; appointment?: { id: number; start_iso: string; label: string; clinic_name: string; clinic_code: string }; error?: string; alternatives?: { start_iso: string; label: string }[] } {
  const name = args.patient_name?.trim();
  if (!name) return { ok: false, error: "patient_name is required." };

  const check = checkSlotAvailable(ctx.clinic, { start_iso: args.start_iso });
  if (!check.available) {
    return { ok: false, error: check.reason ?? "Unavailable.", alternatives: check.alternatives };
  }

  const start = parseIsoToClinic(args.start_iso, ctx.clinic);
  const startUtc = toUtcIso(start);
  const endUtc = toUtcIso(endOfSlot(start, ctx.clinic));

  try {
    const result = db
      .prepare(
        `INSERT INTO appointments (patient_name, phone, start_utc, end_utc, reason, clinic_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(name, ctx.phone, startUtc, endUtc, args.reason ?? null, ctx.clinic.id);
    return {
      ok: true,
      appointment: {
        id: Number(result.lastInsertRowid),
        start_iso: startUtc,
        label: humanLocal(start, ctx.clinic),
        clinic_name: ctx.clinic.name,
        clinic_code: ctx.clinic.code,
      },
    };
  } catch (e: any) {
    // partial unique-index violation = race condition
    if (String(e?.message ?? "").includes("UNIQUE")) {
      const alt = checkSlotAvailable(ctx.clinic, { start_iso: args.start_iso });
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
    // Label each appointment in its own clinic's timezone.
    const rowClinic = getClinic(r.clinic_id) ?? ctx.clinic;
    upcoming.push({
      id: r.id,
      start_iso: r.start_utc,
      label: humanLocal(parseIsoToClinic(r.start_utc, rowClinic), rowClinic),
      patient_name: r.patient_name,
      reason: r.reason,
      clinic_name: rowClinic.name,
      clinic_code: rowClinic.code,
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
): { ok: boolean; appointment?: { id: number; start_iso: string; label: string; clinic_name: string; clinic_code: string }; error?: string; alternatives?: { start_iso: string; label: string }[] } {
  const row = ownAppointment(ctx, args.appointment_id);
  if (!row) return { ok: false, error: "Appointment not found for your number." };
  if (row.status !== "booked") return { ok: false, error: "Appointment is not active." };

  // Validate against the appointment's own clinic, not whichever is active.
  const clinic = getClinic(row.clinic_id) ?? ctx.clinic;
  const check = checkSlotAvailable(clinic, { start_iso: args.new_start_iso });
  if (!check.available) {
    return { ok: false, error: check.reason ?? "Unavailable.", alternatives: check.alternatives };
  }
  const start = parseIsoToClinic(args.new_start_iso, clinic);
  const startUtc = toUtcIso(start);
  const endUtc = toUtcIso(endOfSlot(start, clinic));

  try {
    db.prepare(
      `UPDATE appointments SET start_utc = ?, end_utc = ? WHERE id = ?`,
    ).run(startUtc, endUtc, row.id);
    return {
      ok: true,
      appointment: {
        id: row.id,
        start_iso: startUtc,
        label: humanLocal(start, clinic),
        clinic_name: clinic.name,
        clinic_code: clinic.code,
      },
    };
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      const alt = checkSlotAvailable(ctx.clinic, { start_iso: args.new_start_iso });
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
  const clinic = getClinic(row.clinic_id) ?? ctx.clinic;
  return { ok: true, clinic_name: clinic.name, clinic_code: clinic.code };
}
