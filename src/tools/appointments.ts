import { db, type AppointmentRow } from "../db";
import type { Clinic } from "../clinics";
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
): { ok: boolean; appointment?: { id: number; start_iso: string; label: string }; error?: string; alternatives?: { start_iso: string; label: string }[] } {
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
  upcoming: { id: number; start_iso: string; label: string; patient_name: string; reason: string | null }[];
} {
  const nowUtc = toUtcIso(nowInClinicTz(ctx.clinic));
  const rows = db
    .prepare(
      `SELECT * FROM appointments
       WHERE phone = ? AND clinic_id = ? AND status = 'booked' AND start_utc >= ?
       ORDER BY start_utc ASC`,
    )
    .all(ctx.phone, ctx.clinic.id, nowUtc) as AppointmentRow[];

  return {
    upcoming: rows.map((r) => ({
      id: r.id,
      start_iso: r.start_utc,
      label: humanLocal(parseIsoToClinic(r.start_utc, ctx.clinic), ctx.clinic),
      patient_name: r.patient_name,
      reason: r.reason,
    })),
  };
}

function ownAppointment(ctx: ToolContext, id: number): AppointmentRow | null {
  const row = db
    .prepare(`SELECT * FROM appointments WHERE id = ? AND phone = ? AND clinic_id = ?`)
    .get(id, ctx.phone, ctx.clinic.id) as AppointmentRow | undefined;
  return row ?? null;
}

export function rescheduleAppointment(
  ctx: ToolContext,
  args: { appointment_id: number; new_start_iso: string },
): { ok: boolean; appointment?: { id: number; start_iso: string; label: string }; error?: string; alternatives?: { start_iso: string; label: string }[] } {
  const row = ownAppointment(ctx, args.appointment_id);
  if (!row) return { ok: false, error: "Appointment not found for your number." };
  if (row.status !== "booked") return { ok: false, error: "Appointment is not active." };

  const check = checkSlotAvailable(ctx.clinic, { start_iso: args.new_start_iso });
  if (!check.available) {
    return { ok: false, error: check.reason ?? "Unavailable.", alternatives: check.alternatives };
  }
  const start = parseIsoToClinic(args.new_start_iso, ctx.clinic);
  const startUtc = toUtcIso(start);
  const endUtc = toUtcIso(endOfSlot(start, ctx.clinic));

  try {
    db.prepare(
      `UPDATE appointments SET start_utc = ?, end_utc = ? WHERE id = ?`,
    ).run(startUtc, endUtc, row.id);
    return {
      ok: true,
      appointment: { id: row.id, start_iso: startUtc, label: humanLocal(start, ctx.clinic) },
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
): { ok: boolean; error?: string } {
  const row = ownAppointment(ctx, args.appointment_id);
  if (!row) return { ok: false, error: "Appointment not found for your number." };
  if (row.status !== "booked") return { ok: false, error: "Already cancelled." };
  db.prepare(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`).run(row.id);
  return { ok: true };
}
