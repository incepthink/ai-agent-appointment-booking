import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";

// DB location is overridable via CLINIC_DB_PATH so tests (and alternate
// deployments) can point at an isolated file or ":memory:". Defaults to the
// app's data/clinic.db — production behaviour is unchanged when unset.
const dbPath = process.env.CLINIC_DB_PATH || path.join(path.resolve(process.cwd(), "data"), "clinic.db");
if (dbPath !== ":memory:") {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(dbPath);
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

  -- One row per handled inbound message: how long the reply took and why.
  -- Used to track the agent's response time (the headline number patients feel)
  -- and to break it down — LLM round-trips vs tool calls vs token bloat vs the
  -- WhatsApp send — so we know which lever to pull. source distinguishes real
  -- WhatsApp traffic from the local /chat test endpoint.
  CREATE TABLE IF NOT EXISTS message_metrics (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    phone             TEXT,
    clinic_id         INTEGER REFERENCES clinics(id),
    source            TEXT NOT NULL DEFAULT 'whatsapp',
    model             TEXT,
    total_ms          INTEGER NOT NULL,
    handle_ms         INTEGER NOT NULL,
    send_ms           INTEGER,
    llm_ms            INTEGER NOT NULL,
    llm_calls         INTEGER NOT NULL,
    tool_calls        INTEGER NOT NULL,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens     INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS ix_metrics_created ON message_metrics(created_at);
  CREATE INDEX IF NOT EXISTS ix_metrics_clinic ON message_metrics(clinic_id, created_at);
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
// Free-form knowledge base the WhatsApp agent reads: services, pricing,
// insurance, parking, "why choose us", first-visit info — whatever the owner
// wants the agent to know when talking to patients.
addClinicCol("knowledge", "knowledge TEXT");
// Unique email for login lookups (partial: ignores seeded clinics with NULL email).
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS uq_clinic_email
    ON clinics(email) WHERE email IS NOT NULL;
`);

// --- Seed clinic profile + knowledge for the test clinics ---
// The SEED_CLINICS insert above uses INSERT OR IGNORE and only sets scheduling
// columns, so profile/knowledge stay NULL on a fresh row. Backfill them here so
// dev DBs have realistic content for the agent to draw on. Guarded on
// `knowledge IS NULL` so a clinic owner's later edits are never clobbered.
const SEED_CLINIC_PROFILES: Record<
  string,
  { description: string; address: string; contact_phone: string; knowledge: string }
> = {
  SUNRISE: {
    description:
      "Sunrise Clinic is a neighbourhood family practice focused on quick, friendly general care.",
    address: "12 MG Road, Bengaluru 560001",
    contact_phone: "+91 80 4000 1234",
    knowledge: [
      "Services: general consultations, health checkups, common illnesses (fever, cough, infections), blood-pressure and diabetes follow-ups.",
      "Consultation fee: ₹500 for a first visit, ₹300 for a follow-up within 30 days.",
      "Insurance: we accept most major health insurers for cashless OPD; bring your insurance card.",
      "Payments: cash, UPI, and all major cards accepted.",
      "First visit: please arrive 10 minutes early and bring any past prescriptions or reports.",
      "Parking: free two-wheeler and limited car parking on-site.",
      "Why patients choose us: short wait times, same-day slots most days, and doctors who explain things in plain language.",
    ].join("\n"),
  },
  HARBOR: {
    description:
      "Harbor Medical is a primary-care clinic serving the downtown waterfront community.",
    address: "88 Harbor View Ave, New York, NY 10004",
    contact_phone: "+1 212-555-0142",
    knowledge: [
      "Services: primary care, annual physicals, common illnesses, preventive screenings, and routine follow-ups.",
      "Consultation fee: $120 for a new patient visit, $80 for an established-patient follow-up.",
      "Insurance: in-network with most major US plans; please have your member ID ready.",
      "Payments: cash, all major cards, HSA/FSA cards accepted.",
      "First visit: arrive 15 minutes early to complete intake; bring a photo ID and insurance card.",
      "Parking: paid garage next door; street parking is metered.",
      "Why patients choose us: easy online scheduling, minimal wait times, and a small, consistent care team.",
    ].join("\n"),
  },
  LOTUS: {
    description:
      "Lotus Multi-Speciality brings general medicine, dermatology, and pediatrics together under one roof.",
    address: "5 Lotus Avenue, Indiranagar, Bengaluru 560038",
    contact_phone: "+91 80 4555 7788",
    knowledge: [
      "Specialities: General Medicine (Dr. Anil Rao), Dermatology (Dr. Sana Mehta), and Pediatrics (Dr. Priya Iyer).",
      "Consultation fees: ₹600 general medicine, ₹800 dermatology, ₹700 pediatrics; follow-ups within 14 days are half price.",
      "Insurance: cashless OPD available with most major insurers; carry your insurance card and a photo ID.",
      "Payments: cash, UPI, and all major cards accepted.",
      "First visit: arrive 10 minutes early; for children, bring the vaccination record.",
      "Parking: dedicated patient parking in the basement.",
      "Why patients choose us: multiple specialists in one place, same-week dermatology and pediatric slots, and a calm, child-friendly waiting area.",
    ].join("\n"),
  },
};

const backfillClinicProfile = db.prepare(
  `UPDATE clinics
     SET description = @description,
         address = @address,
         contact_phone = @contact_phone,
         knowledge = @knowledge
   WHERE code = @code AND knowledge IS NULL`,
);
for (const [code, p] of Object.entries(SEED_CLINIC_PROFILES)) {
  backfillClinicProfile.run({ code, ...p });
}

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
  knowledge: string | null;
};

export type SessionRow = {
  phone: string;
  active_clinic_id: number | null;
  active_doctor_id: number | null;
  updated_at: string;
};
