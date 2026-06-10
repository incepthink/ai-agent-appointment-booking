import { db, type DoctorRow } from "./db";
import { parseDays, type Day } from "./clinics";

// A doctor's bookable schedule. `tz` is denormalized from the doctor's clinic at
// load time so a Doctor is structurally a `Schedule` (see tools/time.ts) and can
// flow straight into the slot/availability engine. Hours/days/slot are per-doctor.
export type Doctor = {
  id: number;
  clinicId: number;
  code: string;
  name: string;
  specialty: string;
  bio: string | null;
  tz: string;
  open: string;
  close: string;
  days: Day[];
  slotMinutes: number;
};

// Dashboard/agent-facing profile (adds email; never exposes password_hash).
export type DoctorProfile = Doctor & { email: string | null };

type DoctorJoinRow = DoctorRow & { clinic_tz: string };

const SELECT_DOCTOR = `
  SELECT d.*, c.tz AS clinic_tz
  FROM doctors d
  JOIN clinics c ON c.id = d.clinic_id
`;

function toDoctor(row: DoctorJoinRow): Doctor {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    code: row.code,
    name: row.name,
    specialty: row.specialty,
    bio: row.bio,
    tz: row.clinic_tz,
    open: row.open,
    close: row.close,
    days: parseDays(row.days),
    slotMinutes: row.slot_minutes,
  };
}

function toProfile(row: DoctorJoinRow): DoctorProfile {
  return { ...toDoctor(row), email: row.email };
}

export function getDoctor(id: number): Doctor | null {
  const row = db.prepare(`${SELECT_DOCTOR} WHERE d.id = ?`).get(id) as DoctorJoinRow | undefined;
  return row ? toDoctor(row) : null;
}

export function getDoctorByCode(code: string): Doctor | null {
  const row = db
    .prepare(`${SELECT_DOCTOR} WHERE d.code = ? AND d.active = 1`)
    .get(code.trim().toUpperCase()) as DoctorJoinRow | undefined;
  return row ? toDoctor(row) : null;
}

export function listClinicDoctors(clinicId: number): Doctor[] {
  const rows = db
    .prepare(`${SELECT_DOCTOR} WHERE d.clinic_id = ? AND d.active = 1 ORDER BY d.name ASC`)
    .all(clinicId) as DoctorJoinRow[];
  return rows.map(toDoctor);
}

// The doctor the patient is currently booking with (parallels getActiveClinic).
export function getActiveDoctor(phone: string): Doctor | null {
  const row = db
    .prepare(`${SELECT_DOCTOR}
       JOIN sessions s ON s.active_doctor_id = d.id
       WHERE s.phone = ? AND d.active = 1`)
    .get(phone) as DoctorJoinRow | undefined;
  return row ? toDoctor(row) : null;
}

export function setActiveDoctor(phone: string, doctorId: number): void {
  // The session row already exists (a clinic was selected first); just set the doctor.
  db.prepare(
    `UPDATE sessions SET active_doctor_id = ?, updated_at = datetime('now') WHERE phone = ?`,
  ).run(doctorId, phone);
}

export function clearActiveDoctor(phone: string): void {
  db.prepare(
    `UPDATE sessions SET active_doctor_id = NULL, updated_at = datetime('now') WHERE phone = ?`,
  ).run(phone);
}

// --- Dashboard: per-doctor auth + self-service profile ---

export function getDoctorProfile(id: number): DoctorProfile | null {
  const row = db.prepare(`${SELECT_DOCTOR} WHERE d.id = ?`).get(id) as DoctorJoinRow | undefined;
  return row ? toProfile(row) : null;
}

// Full row (incl. password_hash) for login checks. No tz join needed.
export function getDoctorRowByEmail(email: string): DoctorRow | null {
  const row = db
    .prepare(`SELECT * FROM doctors WHERE email = ? AND active = 1`)
    .get(email.trim().toLowerCase()) as DoctorRow | undefined;
  return row ?? null;
}

// Partial update of a doctor's own schedule/profile. Only provided fields change.
export function updateDoctor(
  id: number,
  fields: Partial<{
    name: string;
    specialty: string;
    bio: string | null;
    open: string;
    close: string;
    days: Day[];
    slotMinutes: number;
  }>,
): DoctorProfile | null {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    vals.push(val);
  };
  if (fields.name !== undefined) push("name", fields.name.trim());
  if (fields.specialty !== undefined) push("specialty", fields.specialty.trim());
  if (fields.bio !== undefined) push("bio", fields.bio);
  if (fields.open !== undefined) push("open", fields.open);
  if (fields.close !== undefined) push("close", fields.close);
  if (fields.days !== undefined) push("days", fields.days.join(","));
  if (fields.slotMinutes !== undefined) push("slot_minutes", fields.slotMinutes);

  if (sets.length === 0) return getDoctorProfile(id);
  vals.push(id);
  db.prepare(`UPDATE doctors SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getDoctorProfile(id);
}

export function setDoctorPassword(id: number, passwordHash: string): void {
  db.prepare(`UPDATE doctors SET password_hash = ? WHERE id = ?`).run(passwordHash, id);
}
