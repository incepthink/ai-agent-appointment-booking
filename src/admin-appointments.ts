import { db, type AppointmentRow } from "./db";
import { getClinic, type Clinic } from "./clinics";
import { getDoctor } from "./doctors";
import { emitAppointmentsChanged } from "./events";
import { checkSlotAvailable } from "./tools/slots";
import { isPlaceholderName } from "./tools/appointments";
import { endOfSlot, humanLocal, parseIsoToClinic, toUtcIso } from "./tools/time";

// Dashboard-facing appointment shape (clinic-scoped, rendered in clinic tz). The
// view is unified across the clinic's doctors, so each row names its doctor.
export type AdminAppointment = {
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

function toAdmin(row: AppointmentRow, clinic: Clinic): AdminAppointment {
  const doctor = getDoctor(row.doctor_id);
  return {
    id: row.id,
    patient_name: row.patient_name,
    phone: row.phone,
    start_iso: row.start_utc,
    end_iso: row.end_utc,
    label: humanLocal(parseIsoToClinic(row.start_utc, clinic), clinic),
    reason: row.reason,
    status: row.status,
    doctor_id: row.doctor_id,
    doctor_name: doctor?.name ?? null,
    created_at: row.created_at,
  };
}

// List a clinic's appointments (all doctors), optionally filtered by UTC range,
// status, and a specific doctor.
export function listClinicAppointments(
  clinicId: number,
  filters: { from?: string; to?: string; status?: "booked" | "cancelled"; doctorId?: number } = {},
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
  if (filters.doctorId !== undefined) {
    where.push("doctor_id = ?");
    params.push(filters.doctorId);
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

// Manually book an appointment as a clinic doctor (no phone-ownership scoping).
// The appointment is booked against a specific doctor of this clinic.
export function adminCreateAppointment(
  clinicId: number,
  args: { patient_name: string; phone: string; start_iso: string; reason?: string; doctor_id: number },
): AdminResult {
  const clinic = getClinic(clinicId);
  if (!clinic) return { ok: false, error: "Clinic not found." };

  const name = args.patient_name?.trim();
  if (!name) return { ok: false, error: "patient_name is required." };
  // Parity with the agent's booking path: reject placeholder/relationship words
  // ("Patient", "Unknown", "grandmother", …) so the dashboard can't create the
  // same junk records the agent is forbidden from creating. (Grounding doesn't
  // apply here — there's no conversation to ground against.)
  if (isPlaceholderName(name)) {
    return { ok: false, error: `"${name}" is not a valid patient name. Enter the patient's real name.` };
  }
  const phone = args.phone?.trim();
  if (!phone) return { ok: false, error: "phone is required." };

  const doctor = getDoctor(args.doctor_id);
  if (!doctor || doctor.clinicId !== clinicId) {
    return { ok: false, error: "Select a doctor at this clinic." };
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
      .run(name, phone, startUtc, endUtc, args.reason?.trim() || null, clinic.id, doctor.id);
    const row = db
      .prepare(`SELECT * FROM appointments WHERE id = ?`)
      .get(Number(result.lastInsertRowid)) as AppointmentRow;
    emitAppointmentsChanged(clinic.id);
    return { ok: true, appointment: toAdmin(row, clinic) };
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      const alt = checkSlotAvailable(doctor, { start_iso: args.start_iso });
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

  // Validate the new time against the appointment's own doctor (their hours/calendar).
  const doctor = getDoctor(row.doctor_id);
  if (!doctor) return { ok: false, error: "Appointment's doctor is unavailable." };

  const check = checkSlotAvailable(doctor, { start_iso: newStartIso });
  if (!check.available) {
    return { ok: false, error: check.reason ?? "Unavailable.", alternatives: check.alternatives };
  }

  const start = parseIsoToClinic(newStartIso, doctor);
  const startUtc = toUtcIso(start);
  const endUtc = toUtcIso(endOfSlot(start, doctor));

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
      const alt = checkSlotAvailable(doctor, { start_iso: newStartIso });
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
