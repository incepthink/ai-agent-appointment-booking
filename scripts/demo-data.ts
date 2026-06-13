/**
 * Demo data for the sales video — fully reversible.
 *
 * Fills the Lotus Multi-Speciality calendar with believable background
 * appointments so the dashboard looks like a real, busy clinic behind the live
 * WhatsApp booking we record. Every row carries a reserved demo phone prefix
 * (+9199000…) so teardown deletes EXACTLY these rows and nothing else — the real
 * booking you make on camera (a real phone number) is never touched.
 *
 *   tsx scripts/demo-data.ts seed      # back up the DB, then insert demo appts
 *   tsx scripts/demo-data.ts clean     # delete only the +9199000… demo rows
 *   tsx scripts/demo-data.ts restore   # restore the pre-demo DB backup (nuclear)
 *
 * The "today 11:30 AM with Dr. Rao" slot is intentionally left free so the live
 * booking in the video lands on an empty slot and shows up on the calendar.
 */
import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import { db, type ClinicRow, type DoctorRow } from "../src/db";
import {
  toUtcIso,
  endOfSlot,
  isClinicOpenDay,
  type Schedule,
} from "../src/tools/time";

const DEMO_PHONE_PREFIX = "+9199000"; // reserved block; LIKE '+9199000%' for teardown
const DEMO_LIKE = `${DEMO_PHONE_PREFIX}%`;
const LOTUS_CODE = "LOTUS";

const dbPath =
  process.env.CLINIC_DB_PATH || path.join(process.cwd(), "data", "clinic.db");
const backupPath = `${dbPath}.pre-demo.bak`;

// --- helpers ---------------------------------------------------------------

function getClinic(): ClinicRow {
  const clinic = db
    .prepare(`SELECT * FROM clinics WHERE code = ?`)
    .get(LOTUS_CODE) as ClinicRow | undefined;
  if (!clinic) throw new Error(`Clinic ${LOTUS_CODE} not found — start the app once to seed it.`);
  return clinic;
}

function scheduleOf(clinic: ClinicRow, d: DoctorRow): Schedule {
  return {
    tz: clinic.tz,
    open: d.open,
    close: d.close,
    days: d.days.split(",") as Schedule["days"],
    slotMinutes: d.slot_minutes,
  };
}

// --- demo content ----------------------------------------------------------

const NAMES = [
  "Asha Menon", "Rohan Gupta", "Priya Nair", "Vikram Shah", "Meera Iyer",
  "Arjun Reddy", "Sneha Rao", "Karan Malhotra", "Divya Pillai", "Aditya Bose",
  "Neha Verma", "Sanjay Kulkarni", "Pooja Desai", "Rahul Khanna", "Ananya Das",
  "Manish Joshi", "Ritu Agarwal", "Farhan Sheikh", "Lakshmi Krishnan", "Tarun Mehta",
  "Ishaan Roy", "Kavya Menon", "Dev Patel", "Anjali Shah",
];

const REASONS: Record<string, string[]> = {
  "General Physician": [
    "Fever and cough", "BP follow-up", "Diabetes review", "Sore throat",
    "Stomach ache", "Routine checkup", "Cold and congestion",
  ],
  Dermatologist: ["Acne consultation", "Skin rash", "Hair loss", "Eczema follow-up", "Allergy review"],
  Pediatrician: ["Child fever", "Vaccination", "Infant checkup", "Childhood cough"],
};

// Per-doctor times on the 30-min grid, inside each doctor's hours.
const TIME_POOL: Record<string, [number, number][]> = {
  "LOTUS-RAO": [[9, 30], [10, 0], [11, 30], [14, 0], [15, 30], [16, 0]],
  "LOTUS-MEHTA": [[11, 30], [12, 0], [15, 0], [16, 30], [17, 30]],
  "LOTUS-IYER": [[9, 30], [10, 30], [11, 0], [12, 0]],
};

// The slot we deliberately keep open for the on-camera live booking.
const RESERVED = { doctorCode: "LOTUS-RAO", hour: 11, minute: 30 };

// --- seed ------------------------------------------------------------------

type Spec = { doctor: DoctorRow; dt: DateTime };

function buildSpecs(clinic: ClinicRow, doctors: DoctorRow[]): Spec[] {
  const byCode = Object.fromEntries(doctors.map((d) => [d.code, d]));
  const today = DateTime.now().setZone(clinic.tz).startOf("day");
  const monthStart = today.startOf("month");
  const daysInMonth = today.daysInMonth!;
  const specs: Spec[] = [];

  const tryAdd = (doctor: DoctorRow | undefined, dt: DateTime) => {
    if (!doctor) return;
    if (!isClinicOpenDay(dt, scheduleOf(clinic, doctor))) return;
    if (
      doctor.code === RESERVED.doctorCode &&
      dt.hasSame(today, "day") &&
      dt.hour === RESERVED.hour &&
      dt.minute === RESERVED.minute
    )
      return; // keep the live-booking slot free
    specs.push({ doctor, dt });
  };

  // Background spread across the whole month: ~2 of every 3 days, rotating doctors.
  const order = ["LOTUS-RAO", "LOTUS-MEHTA", "LOTUS-IYER", "LOTUS-RAO"];
  let oi = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    if (day % 3 === 0) continue; // leave gaps so it reads as natural, not every-day
    const doctor = byCode[order[oi++ % order.length]];
    if (!doctor) continue;
    const pool = TIME_POOL[doctor.code] ?? [[10, 0]];
    const [h, m] = pool[day % pool.length];
    tryAdd(doctor, monthStart.set({ day, hour: h, minute: m, second: 0, millisecond: 0 }));
  }

  // The on-camera day (today): a small cluster across doctors, 11:30/Rao left free.
  const todaySlots: [string, number, number][] = [
    ["LOTUS-RAO", 9, 30],
    ["LOTUS-RAO", 10, 0],
    ["LOTUS-RAO", 15, 0],
    ["LOTUS-MEHTA", 12, 0],
    ["LOTUS-IYER", 10, 30],
  ];
  for (const [code, h, m] of todaySlots) {
    tryAdd(byCode[code], today.set({ hour: h, minute: m, second: 0, millisecond: 0 }));
  }

  return specs;
}

function insertSpecs(clinic: ClinicRow, specs: Spec[]): number {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO appointments
       (patient_name, phone, start_utc, end_utc, reason, status, clinic_id, doctor_id)
     VALUES (?, ?, ?, ?, ?, 'booked', ?, ?)`,
  );
  let serial = 1;
  let inserted = 0;
  const run = db.transaction(() => {
    specs.forEach((s, i) => {
      const sched = scheduleOf(clinic, s.doctor);
      const reasons = REASONS[s.doctor.specialty] ?? ["Consultation"];
      const phone = `${DEMO_PHONE_PREFIX}${String(serial++).padStart(5, "0")}`;
      const r = insert.run(
        NAMES[i % NAMES.length],
        phone,
        toUtcIso(s.dt),
        toUtcIso(endOfSlot(s.dt, sched)),
        reasons[i % reasons.length],
        clinic.id,
        s.doctor.id,
      );
      if (r.changes > 0) inserted++;
    });
  });
  run();
  return inserted;
}

function deleteDemoRows(): number {
  let total = 0;
  // Surgical: only rows carrying the reserved demo phone prefix.
  for (const table of ["appointments", "conversations", "message_metrics"]) {
    const r = db.prepare(`DELETE FROM ${table} WHERE phone LIKE ?`).run(DEMO_LIKE);
    total += r.changes;
  }
  return total;
}

async function seed() {
  const existing = (
    db.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE phone LIKE ?`).get(DEMO_LIKE) as { n: number }
  ).n;
  if (existing > 0) {
    console.log(`Found ${existing} existing demo rows — cleaning them first.`);
    deleteDemoRows();
  }

  if (dbPath !== ":memory:") {
    await db.backup(backupPath);
    console.log(`Backed up DB → ${backupPath}`);
  }

  const clinic = getClinic();
  const doctors = db
    .prepare(`SELECT * FROM doctors WHERE clinic_id = ? AND active = 1`)
    .all(clinic.id) as DoctorRow[];
  if (doctors.length === 0) throw new Error("No active Lotus doctors found.");

  const specs = buildSpecs(clinic, doctors);
  const inserted = insertSpecs(clinic, specs);

  const today = DateTime.now().setZone(clinic.tz);
  console.log(`Seeded ${inserted} demo appointments for ${clinic.name} (${clinic.tz}).`);
  console.log(
    `Reserved slot kept free: Dr. Anil Rao, today (${today.toFormat("ccc LLL d")}) at 11:30 AM — book this one live on camera.`,
  );
  if (inserted < 8) {
    console.warn(
      "Heads up: fewer rows than expected landed. If today is a Sunday, most Lotus doctors are closed — record Mon–Sat for a full calendar.",
    );
  }
}

function clean() {
  const removed = deleteDemoRows();
  console.log(`Removed ${removed} demo rows (phone LIKE '${DEMO_LIKE}').`);
}

function restore() {
  if (!fs.existsSync(backupPath)) {
    console.error(`No backup at ${backupPath}. Nothing to restore (run \`seed\` first).`);
    process.exit(1);
  }
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.copyFileSync(backupPath, dbPath);
  console.log(`Restored DB from ${backupPath}.`);
}

// --- cli -------------------------------------------------------------------

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case "seed":
      await seed();
      break;
    case "clean":
      clean();
      break;
    case "restore":
      restore();
      break;
    default:
      console.error("Usage: tsx scripts/demo-data.ts <seed|clean|restore>");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
