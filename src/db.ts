import Database from "better-sqlite3";
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

  CREATE TABLE IF NOT EXISTS sessions (
    phone            TEXT PRIMARY KEY,
    active_clinic_id INTEGER REFERENCES clinics(id),
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

// --- Seed the two test clinics (idempotent, keyed on code) ---
const SEED_CLINICS = [
  { code: "SUNRISE", name: "Sunrise Clinic", tz: "Asia/Kolkata", open: "09:00", close: "18:00", days: "Mon,Tue,Wed,Thu,Fri,Sat", slot_minutes: 30 },
  { code: "HARBOR", name: "Harbor Medical", tz: "America/New_York", open: "08:00", close: "16:00", days: "Mon,Tue,Wed,Thu,Fri", slot_minutes: 30 },
] as const;

const seedClinic = db.prepare(
  `INSERT OR IGNORE INTO clinics (code, name, tz, open, close, days, slot_minutes)
   VALUES (@code, @name, @tz, @open, @close, @days, @slot_minutes)`,
);
for (const c of SEED_CLINICS) seedClinic.run(c);

// --- Migration: backfill clinic_id on pre-existing appointments ---
// The DB may predate the clinic_id column / composite index. ALTER if missing,
// backfill orphaned rows to the first seed clinic, then (re)create the composite
// unique index so two clinics CAN share the same wall-clock slot.
const apptCols = db.prepare(`PRAGMA table_info(appointments)`).all() as { name: string }[];
if (!apptCols.some((c) => c.name === "clinic_id")) {
  db.exec(`ALTER TABLE appointments ADD COLUMN clinic_id INTEGER REFERENCES clinics(id)`);
}

const defaultClinicId = (
  db.prepare(`SELECT id FROM clinics WHERE code = ?`).get(SEED_CLINICS[0].code) as { id: number }
).id;
db.prepare(`UPDATE appointments SET clinic_id = ? WHERE clinic_id IS NULL`).run(defaultClinicId);

// Replace any legacy single-column index with the composite (clinic_id, start_utc).
db.exec(`
  DROP INDEX IF EXISTS uq_active_slot;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_active_slot
    ON appointments(clinic_id, start_utc) WHERE status = 'booked';
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
};

export type SessionRow = {
  phone: string;
  active_clinic_id: number | null;
  updated_at: string;
};
