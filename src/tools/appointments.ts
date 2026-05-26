import { db, type AppointmentRow } from "../db";
import { checkSlotAvailable } from "./slots";
import {
  endOfSlot,
  humanLocal,
  nowInClinicTz,
  parseIsoToClinic,
  toUtcIso,
} from "./time";

export type ToolContext = { phone: string };

export function createAppointment(
  ctx: ToolContext,
  args: { patient_name: string; start_iso: string; reason?: string },
): { ok: boolean; appointment?: { id: number; start_iso: string; label: string }; error?: string; alternatives?: { start_iso: string; label: string }[] } {
  const name = args.patient_name?.trim();
  if (!name) return { ok: false, error: "patient_name is required." };

  const check = checkSlotAvailable({ start_iso: args.start_iso });
  if (!check.available) {
    return { ok: false, error: check.reason ?? "Unavailable.", alternatives: check.alternatives };
  }

  const start = parseIsoToClinic(args.start_iso);
  const startUtc = toUtcIso(start);
  const endUtc = toUtcIso(endOfSlot(start));

  try {
    const result = db
      .prepare(
        `INSERT INTO appointments (patient_name, phone, start_utc, end_utc, reason)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(name, ctx.phone, startUtc, endUtc, args.reason ?? null);
    return {
      ok: true,
      appointment: {
        id: Number(result.lastInsertRowid),
        start_iso: startUtc,
        label: humanLocal(start),
      },
    };
  } catch (e: any) {
    // partial unique-index violation = race condition
    if (String(e?.message ?? "").includes("UNIQUE")) {
      const alt = checkSlotAvailable({ start_iso: args.start_iso });
      return { ok: false, error: "Slot was just taken.", alternatives: alt.alternatives };
    }
    throw e;
  }
}

export function findAppointments(ctx: ToolContext): {
  upcoming: { id: number; start_iso: string; label: string; patient_name: string; reason: string | null }[];
} {
  const nowUtc = toUtcIso(nowInClinicTz());
  const rows = db
    .prepare(
      `SELECT * FROM appointments
       WHERE phone = ? AND status = 'booked' AND start_utc >= ?
       ORDER BY start_utc ASC`,
    )
    .all(ctx.phone, nowUtc) as AppointmentRow[];

  return {
    upcoming: rows.map((r) => ({
      id: r.id,
      start_iso: r.start_utc,
      label: humanLocal(parseIsoToClinic(r.start_utc)),
      patient_name: r.patient_name,
      reason: r.reason,
    })),
  };
}

function ownAppointment(ctx: ToolContext, id: number): AppointmentRow | null {
  const row = db
    .prepare(`SELECT * FROM appointments WHERE id = ?`)
    .get(id) as AppointmentRow | undefined;
  if (!row) return null;
  if (row.phone !== ctx.phone) return null;
  return row;
}

export function rescheduleAppointment(
  ctx: ToolContext,
  args: { appointment_id: number; new_start_iso: string },
): { ok: boolean; appointment?: { id: number; start_iso: string; label: string }; error?: string; alternatives?: { start_iso: string; label: string }[] } {
  const row = ownAppointment(ctx, args.appointment_id);
  if (!row) return { ok: false, error: "Appointment not found for your number." };
  if (row.status !== "booked") return { ok: false, error: "Appointment is not active." };

  const check = checkSlotAvailable({ start_iso: args.new_start_iso });
  if (!check.available) {
    return { ok: false, error: check.reason ?? "Unavailable.", alternatives: check.alternatives };
  }
  const start = parseIsoToClinic(args.new_start_iso);
  const startUtc = toUtcIso(start);
  const endUtc = toUtcIso(endOfSlot(start));

  try {
    db.prepare(
      `UPDATE appointments SET start_utc = ?, end_utc = ? WHERE id = ?`,
    ).run(startUtc, endUtc, row.id);
    return {
      ok: true,
      appointment: { id: row.id, start_iso: startUtc, label: humanLocal(start) },
    };
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      const alt = checkSlotAvailable({ start_iso: args.new_start_iso });
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
