import { db, type AppointmentRow } from "./db";
import { getClinic, type Clinic } from "./clinics";
import { emitAppointmentsChanged } from "./events";
import { checkSlotAvailable } from "./tools/slots";
import { endOfSlot, humanLocal, parseIsoToClinic, toUtcIso } from "./tools/time";

// Dashboard-facing appointment shape (clinic-scoped, rendered in clinic tz).
export type AdminAppointment = {
  id: number;
  patient_name: string;
  phone: string;
  start_iso: string;
  end_iso: string;
  label: string;
  reason: string | null;
  status: "booked" | "cancelled";
  created_at: string;
};

function toAdmin(row: AppointmentRow, clinic: Clinic): AdminAppointment {
  return {
    id: row.id,
    patient_name: row.patient_name,
    phone: row.phone,
    start_iso: row.start_utc,
    end_iso: row.end_utc,
    label: humanLocal(parseIsoToClinic(row.start_utc, clinic), clinic),
    reason: row.reason,
    status: row.status,
    created_at: row.created_at,
  };
}

// List a clinic's appointments, optionally filtered by UTC range and status.
export function listClinicAppointments(
  clinicId: number,
  filters: { from?: string; to?: string; status?: "booked" | "cancelled" } = {},
): AdminAppointment[] {
  const clinic = getClinic(clinicId);
  if (!clinic) return [];

  const where: string[] = ["clinic_id = ?"];
  const params: unknown[] = [clinicId];
  if (filters.from) {
    where.push("start_utc >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    where.push("start_utc < ?");
    params.push(filters.to);
  }
  if (filters.status) {
    where.push("status = ?");
    params.push(filters.status);
  }

  const rows = db
    .prepare(
      `SELECT * FROM appointments WHERE ${where.join(" AND ")} ORDER BY start_utc ASC`,
    )
    .all(...params) as AppointmentRow[];
  return rows.map((r) => toAdmin(r, clinic));
}

export type AdminResult =
  | { ok: true; appointment: AdminAppointment }
  | { ok: false; error: string; alternatives?: { start_iso: string; label: string }[] };

// Manually book an appointment as the clinic owner (no phone-ownership scoping).
export function adminCreateAppointment(
  clinicId: number,
  args: { patient_name: string; phone: string; start_iso: string; reason?: string },
): AdminResult {
  const clinic = getClinic(clinicId);
  if (!clinic) return { ok: false, error: "Clinic not found." };

  const name = args.patient_name?.trim();
  if (!name) return { ok: false, error: "patient_name is required." };
  const phone = args.phone?.trim();
  if (!phone) return { ok: false, error: "phone is required." };

  const check = checkSlotAvailable(clinic, { start_iso: args.start_iso });
  if (!check.available) {
    return { ok: false, error: check.reason ?? "Unavailable.", alternatives: check.alternatives };
  }

  const start = parseIsoToClinic(args.start_iso, clinic);
  const startUtc = toUtcIso(start);
  const endUtc = toUtcIso(endOfSlot(start, clinic));

  try {
    const result = db
      .prepare(
        `INSERT INTO appointments (patient_name, phone, start_utc, end_utc, reason, clinic_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(name, phone, startUtc, endUtc, args.reason?.trim() || null, clinic.id);
    const row = db
      .prepare(`SELECT * FROM appointments WHERE id = ?`)
      .get(Number(result.lastInsertRowid)) as AppointmentRow;
    emitAppointmentsChanged(clinic.id);
    return { ok: true, appointment: toAdmin(row, clinic) };
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      const alt = checkSlotAvailable(clinic, { start_iso: args.start_iso });
      return { ok: false, error: "Slot was just taken.", alternatives: alt.alternatives };
    }
    throw e;
  }
}

// Resolve an appointment that belongs to this clinic.
function clinicAppointment(clinicId: number, id: number): AppointmentRow | null {
  const row = db
    .prepare(`SELECT * FROM appointments WHERE id = ? AND clinic_id = ?`)
    .get(id, clinicId) as AppointmentRow | undefined;
  return row ?? null;
}

export function adminRescheduleAppointment(
  clinicId: number,
  id: number,
  newStartIso: string,
): AdminResult {
  const clinic = getClinic(clinicId);
  if (!clinic) return { ok: false, error: "Clinic not found." };

  const row = clinicAppointment(clinicId, id);
  if (!row) return { ok: false, error: "Appointment not found." };
  if (row.status !== "booked") return { ok: false, error: "Appointment is not active." };

  const check = checkSlotAvailable(clinic, { start_iso: newStartIso });
  if (!check.available) {
    return { ok: false, error: check.reason ?? "Unavailable.", alternatives: check.alternatives };
  }

  const start = parseIsoToClinic(newStartIso, clinic);
  const startUtc = toUtcIso(start);
  const endUtc = toUtcIso(endOfSlot(start, clinic));

  try {
    db.prepare(`UPDATE appointments SET start_utc = ?, end_utc = ? WHERE id = ?`).run(
      startUtc,
      endUtc,
      row.id,
    );
    const updated = db
      .prepare(`SELECT * FROM appointments WHERE id = ?`)
      .get(row.id) as AppointmentRow;
    emitAppointmentsChanged(clinic.id);
    return { ok: true, appointment: toAdmin(updated, clinic) };
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      const alt = checkSlotAvailable(clinic, { start_iso: newStartIso });
      return { ok: false, error: "Slot was just taken.", alternatives: alt.alternatives };
    }
    throw e;
  }
}

export function adminCancelAppointment(clinicId: number, id: number): AdminResult {
  const clinic = getClinic(clinicId);
  if (!clinic) return { ok: false, error: "Clinic not found." };

  const row = clinicAppointment(clinicId, id);
  if (!row) return { ok: false, error: "Appointment not found." };
  if (row.status !== "booked") return { ok: false, error: "Already cancelled." };

  db.prepare(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`).run(row.id);
  const updated = db
    .prepare(`SELECT * FROM appointments WHERE id = ?`)
    .get(row.id) as AppointmentRow;
  emitAppointmentsChanged(clinic.id);
  return { ok: true, appointment: toAdmin(updated, clinic) };
}
