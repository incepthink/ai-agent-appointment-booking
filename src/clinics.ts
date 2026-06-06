import { db, type ClinicRow } from "./db";

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
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
};

function parseDays(csv: string): Day[] {
  return csv
    .split(",")
    .map((d) => d.trim())
    .filter((d): d is Day => (DAYS as readonly string[]).includes(d));
}

function toClinic(row: ClinicRow): Clinic {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    tz: row.tz,
    open: row.open,
    close: row.close,
    days: parseDays(row.days),
    slotMinutes: row.slot_minutes,
  };
}

export function getClinic(id: number): Clinic | null {
  const row = db.prepare(`SELECT * FROM clinics WHERE id = ?`).get(id) as ClinicRow | undefined;
  return row ? toClinic(row) : null;
}

export function getClinicByCode(code: string): Clinic | null {
  const row = db
    .prepare(`SELECT * FROM clinics WHERE code = ? AND active = 1`)
    .get(code.trim().toUpperCase()) as ClinicRow | undefined;
  return row ? toClinic(row) : null;
}

export function listActiveClinics(): Clinic[] {
  const rows = db
    .prepare(`SELECT * FROM clinics WHERE active = 1 ORDER BY name ASC`)
    .all() as ClinicRow[];
  return rows.map(toClinic);
}

export function getActiveClinic(phone: string): Clinic | null {
  const row = db
    .prepare(
      `SELECT c.* FROM sessions s
       JOIN clinics c ON c.id = s.active_clinic_id
       WHERE s.phone = ? AND c.active = 1`,
    )
    .get(phone) as ClinicRow | undefined;
  return row ? toClinic(row) : null;
}

export function setActiveClinic(phone: string, clinicId: number): void {
  db.prepare(
    `INSERT INTO sessions (phone, active_clinic_id, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(phone) DO UPDATE SET
       active_clinic_id = excluded.active_clinic_id,
       updated_at = excluded.updated_at`,
  ).run(phone, clinicId);
}
