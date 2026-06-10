import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "clinic.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS clinics (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    tz           TEXT NOT NULL,
    open         TEXT NOT NULL,
    close        TEXT NOT NULL,
    days         TEXT NOT NULL,
    slot_minutes INTEGER NOT NULL DEFAULT 30,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS doctors (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id     INTEGER NOT NULL REFERENCES clinics(id),
    code          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    specialty     TEXT NOT NULL,
    bio           TEXT,
    open          TEXT NOT NULL,
    close         TEXT NOT NULL,
    days          TEXT NOT NULL,
    slot_minutes  INTEGER NOT NULL DEFAULT 30,
    email         TEXT,
    password_hash TEXT,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_doctor_email
    ON doctors(email) WHERE email IS NOT NULL;

  CREATE TABLE IF NOT EXISTS sessions (
    phone            TEXT PRIMARY KEY,
    active_clinic_id INTEGER REFERENCES clinics(id),
    active_doctor_id INTEGER REFERENCES doctors(id),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_name TEXT NOT NULL,
    phone        TEXT NOT NULL,
    start_utc    TEXT NOT NULL,
    end_utc      TEXT NOT NULL,
    reason       TEXT,
    status       TEXT NOT NULL DEFAULT 'booked',
    clinic_id    INTEGER REFERENCES clinics(id),
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS ix_phone ON appointments(phone);

  CREATE TABLE IF NOT EXISTS conversations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    phone        TEXT NOT NULL,
    role         TEXT NOT NULL,
    content      TEXT,
    tool_calls   TEXT,
    tool_call_id TEXT,
    name         TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS ix_conv_phone ON conversations(phone, id);
`);

// --- Seed the test clinics (idempotent, keyed on code) ---
const SEED_CLINICS = [
  { code: "SUNRISE", name: "Sunrise Clinic", tz: "Asia/Kolkata", open: "09:00", close: "18:00", days: "Mon,Tue,Wed,Thu,Fri,Sat", slot_minutes: 30 },
  { code: "HARBOR", name: "Harbor Medical", tz: "America/New_York", open: "08:00", close: "16:00", days: "Mon,Tue,Wed,Thu,Fri", slot_minutes: 30 },
  { code: "LOTUS", name: "Lotus Multi-Speciality", tz: "Asia/Kolkata", open: "09:00", close: "19:00", days: "Mon,Tue,Wed,Thu,Fri,Sat", slot_minutes: 30 },
] as const;

const seedClinic = db.prepare(
  `INSERT OR IGNORE INTO clinics (code, name, tz, open, close, days, slot_minutes)
   VALUES (@code, @name, @tz, @open, @close, @days, @slot_minutes)`,
);
for (const c of SEED_CLINICS) seedClinic.run(c);

// --- Seed doctors (idempotent, keyed on code) ---
// Every doctor logs into the dashboard with their own email + password and keeps
// their own working hours (timezone is inherited from their clinic). For local
// testing all seeded doctors share one dev password, hashed synchronously so this
// boot-time seed stays sync. The LOTUS clinic is the multi-doctor test fixture;
// SUNRISE/HARBOR get one default doctor each so their legacy appointments and
// booking flow keep working.
const DEV_DOCTOR_PASSWORD = "clinic123";
const devDoctorHash = bcrypt.hashSync(DEV_DOCTOR_PASSWORD, 10);

const SEED_DOCTORS = [
  // Legacy single-doctor clinics — mirror the clinic's own hours.
  { clinic_code: "SUNRISE", code: "SUNRISE-GP", name: "Dr. Sunrise GP", specialty: "General Physician", bio: "General medicine, checkups and common illnesses.", open: "09:00", close: "18:00", days: "Mon,Tue,Wed,Thu,Fri,Sat", slot_minutes: 30, email: "gp@sunrise.test" },
  { clinic_code: "HARBOR", code: "HARBOR-GP", name: "Dr. Harbor GP", specialty: "General Physician", bio: "General medicine, checkups and common illnesses.", open: "08:00", close: "16:00", days: "Mon,Tue,Wed,Thu,Fri", slot_minutes: 30, email: "gp@harbor.test" },
  // Multi-doctor test clinic.
  { clinic_code: "LOTUS", code: "LOTUS-RAO", name: "Dr. Anil Rao", specialty: "General Physician", bio: "General medicine: fever, cough, infections, routine checkups, blood-pressure and diabetes follow-ups.", open: "09:00", close: "17:00", days: "Mon,Tue,Wed,Thu,Fri,Sat", slot_minutes: 30, email: "rao@lotus.test" },
  { clinic_code: "LOTUS", code: "LOTUS-MEHTA", name: "Dr. Sana Mehta", specialty: "Dermatologist", bio: "Skin, hair and nails: rashes, acne, eczema, allergies, skin infections, hair loss.", open: "11:00", close: "19:00", days: "Tue,Wed,Thu,Fri,Sat", slot_minutes: 30, email: "mehta@lotus.test" },
  { clinic_code: "LOTUS", code: "LOTUS-IYER", name: "Dr. Priya Iyer", specialty: "Pediatrician", bio: "Children's health: infant and child checkups, vaccinations, childhood fevers and illnesses.", open: "09:00", close: "13:00", days: "Mon,Tue,Wed,Thu,Fri", slot_minutes: 30, email: "iyer@lotus.test" },
] as const;

const clinicIdByCode = db.prepare(`SELECT id FROM clinics WHERE code = ?`);
const seedDoctor = db.prepare(
  `INSERT OR IGNORE INTO doctors
     (clinic_id, code, name, specialty, bio, open, close, days, slot_minutes, email, password_hash)
   VALUES (@clinic_id, @code, @name, @specialty, @bio, @open, @close, @days, @slot_minutes, @email, @password_hash)`,
);
for (const d of SEED_DOCTORS) {
  const clinicRow = clinicIdByCode.get(d.clinic_code) as { id: number } | undefined;
  if (!clinicRow) continue;
  seedDoctor.run({
    clinic_id: clinicRow.id,
    code: d.code,
    name: d.name,
    specialty: d.specialty,
    bio: d.bio,
    open: d.open,
    close: d.close,
    days: d.days,
    slot_minutes: d.slot_minutes,
    email: d.email,
    password_hash: devDoctorHash,
  });
}

// --- Migration: backfill clinic_id on pre-existing appointments ---
// The DB may predate the clinic_id / doctor_id columns. ALTER if missing and
// backfill orphaned rows to the first seed clinic.
const apptCols = db.prepare(`PRAGMA table_info(appointments)`).all() as { name: string }[];
if (!apptCols.some((c) => c.name === "clinic_id")) {
  db.exec(`ALTER TABLE appointments ADD COLUMN clinic_id INTEGER REFERENCES clinics(id)`);
}

const defaultClinicId = (
  db.prepare(`SELECT id FROM clinics WHERE code = ?`).get(SEED_CLINICS[0].code) as { id: number }
).id;
db.prepare(`UPDATE appointments SET clinic_id = ? WHERE clinic_id IS NULL`).run(defaultClinicId);

// --- Migration: doctor_id on appointments + per-doctor unique slot index ---
// Each appointment now belongs to a specific doctor. ALTER if missing, backfill
// orphaned rows to their clinic's default (lowest-id) doctor, then swap the
// double-booking guard from (clinic_id, start_utc) to (doctor_id, start_utc) so
// two doctors CAN share a wall-clock slot but one doctor cannot be double-booked.
if (!apptCols.some((c) => c.name === "doctor_id")) {
  db.exec(`ALTER TABLE appointments ADD COLUMN doctor_id INTEGER REFERENCES doctors(id)`);
}
db.prepare(
  `UPDATE appointments
     SET doctor_id = (
       SELECT MIN(d.id) FROM doctors d WHERE d.clinic_id = appointments.clinic_id
     )
   WHERE doctor_id IS NULL`,
).run();

db.exec(`
  DROP INDEX IF EXISTS uq_active_slot;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_active_slot
    ON appointments(doctor_id, start_utc) WHERE status = 'booked';
`);

// --- Migration: active_doctor_id on pre-existing sessions tables ---
const sessionCols = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[];
if (!sessionCols.some((c) => c.name === "active_doctor_id")) {
  db.exec(`ALTER TABLE sessions ADD COLUMN active_doctor_id INTEGER REFERENCES doctors(id)`);
}

// --- Migration: dashboard auth + profile columns on clinics ---
// The owner/admin logs into the dashboard with email + password; profile fields
// flesh out the clinic record the WhatsApp agent already reads. Added here
// (nullable) so pre-existing / seeded clinics keep loading.
const clinicCols = db.prepare(`PRAGMA table_info(clinics)`).all() as { name: string }[];
const addClinicCol = (name: string, ddl: string) => {
  if (!clinicCols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE clinics ADD COLUMN ${ddl}`);
  }
};
addClinicCol("email", "email TEXT");
addClinicCol("password_hash", "password_hash TEXT");
addClinicCol("address", "address TEXT");
addClinicCol("contact_phone", "contact_phone TEXT");
addClinicCol("description", "description TEXT");
// Unique email for login lookups (partial: ignores seeded clinics with NULL email).
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS uq_clinic_email
    ON clinics(email) WHERE email IS NOT NULL;
`);

export type AppointmentRow = {
  id: number;
  patient_name: string;
  phone: string;
  start_utc: string;
  end_utc: string;
  reason: string | null;
  status: "booked" | "cancelled";
  clinic_id: number;
  doctor_id: number;
  created_at: string;
};

export type DoctorRow = {
  id: number;
  clinic_id: number;
  code: string;
  name: string;
  specialty: string;
  bio: string | null;
  open: string;
  close: string;
  days: string;
  slot_minutes: number;
  email: string | null;
  password_hash: string | null;
  active: number;
  created_at: string;
};

export type ClinicRow = {
  id: number;
  code: string;
  name: string;
  tz: string;
  open: string;
  close: string;
  days: string;
  slot_minutes: number;
  active: number;
  created_at: string;
  email: string | null;
  password_hash: string | null;
  address: string | null;
  contact_phone: string | null;
  description: string | null;
};

export type SessionRow = {
  phone: string;
  active_clinic_id: number | null;
  active_doctor_id: number | null;
  updated_at: string;
};
