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

// --- Dashboard: clinic owner/admin account management ---

// Full clinic record including profile + auth fields (dashboard-facing).
export type ClinicProfile = {
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

function toProfile(row: ClinicRow): ClinicProfile {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    tz: row.tz,
    open: row.open,
    close: row.close,
    days: parseDays(row.days),
    slotMinutes: row.slot_minutes,
    email: row.email,
    address: row.address,
    contactPhone: row.contact_phone,
    description: row.description,
  };
}

export function getClinicProfile(id: number): ClinicProfile | null {
  const row = db.prepare(`SELECT * FROM clinics WHERE id = ?`).get(id) as ClinicRow | undefined;
  return row ? toProfile(row) : null;
}

export function getClinicByEmail(email: string): ClinicRow | null {
  const row = db
    .prepare(`SELECT * FROM clinics WHERE email = ?`)
    .get(email.trim().toLowerCase()) as ClinicRow | undefined;
  return row ?? null;
}

// Derive a unique, uppercase clinic code from the name (e.g. "Sunrise Clinic" -> "SUNRISE").
function uniqueCodeFromName(name: string): string {
  const base =
    (name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8) || "CLINIC");
  let code = base;
  let n = 1;
  while (db.prepare(`SELECT 1 FROM clinics WHERE code = ?`).get(code)) {
    code = `${base}${n++}`;
  }
  return code;
}

export function createClinicAccount(input: {
  name: string;
  email: string;
  passwordHash: string;
  tz: string;
  open: string;
  close: string;
  days: Day[];
  slotMinutes: number;
  address?: string | null;
  contactPhone?: string | null;
  description?: string | null;
}): ClinicProfile {
  const code = uniqueCodeFromName(input.name);
  const result = db
    .prepare(
      `INSERT INTO clinics
         (code, name, tz, open, close, days, slot_minutes, active,
          email, password_hash, address, contact_phone, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    )
    .run(
      code,
      input.name.trim(),
      input.tz,
      input.open,
      input.close,
      input.days.join(","),
      input.slotMinutes,
      input.email.trim().toLowerCase(),
      input.passwordHash,
      input.address ?? null,
      input.contactPhone ?? null,
      input.description ?? null,
    );
  return getClinicProfile(Number(result.lastInsertRowid))!;
}

// Partial update of clinic config/profile. Only provided fields are changed.
export function updateClinic(
  id: number,
  fields: Partial<{
    name: string;
    tz: string;
    open: string;
    close: string;
    days: Day[];
    slotMinutes: number;
    address: string | null;
    contactPhone: string | null;
    description: string | null;
  }>,
): ClinicProfile | null {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    vals.push(val);
  };
  if (fields.name !== undefined) push("name", fields.name.trim());
  if (fields.tz !== undefined) push("tz", fields.tz);
  if (fields.open !== undefined) push("open", fields.open);
  if (fields.close !== undefined) push("close", fields.close);
  if (fields.days !== undefined) push("days", fields.days.join(","));
  if (fields.slotMinutes !== undefined) push("slot_minutes", fields.slotMinutes);
  if (fields.address !== undefined) push("address", fields.address);
  if (fields.contactPhone !== undefined) push("contact_phone", fields.contactPhone);
  if (fields.description !== undefined) push("description", fields.description);

  if (sets.length === 0) return getClinicProfile(id);
  vals.push(id);
  db.prepare(`UPDATE clinics SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getClinicProfile(id);
}

// Assign login credentials to an EXISTING clinic (e.g. a seeded clinic that has
// no email/password yet). Looked up by code; returns null if no such clinic.
export function setClinicCredentials(
  code: string,
  email: string,
  passwordHash: string,
): ClinicProfile | null {
  const row = db
    .prepare(`SELECT id FROM clinics WHERE code = ?`)
    .get(code.trim().toUpperCase()) as { id: number } | undefined;
  if (!row) return null;
  db.prepare(`UPDATE clinics SET email = ?, password_hash = ? WHERE id = ?`).run(
    email.trim().toLowerCase(),
    passwordHash,
    row.id,
  );
  return getClinicProfile(row.id);
}

// Update only the password hash (used by the dashboard change-password flow).
export function setClinicPassword(id: number, passwordHash: string): void {
  db.prepare(`UPDATE clinics SET password_hash = ? WHERE id = ?`).run(passwordHash, id);
}
