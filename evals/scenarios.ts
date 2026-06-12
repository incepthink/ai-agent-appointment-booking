// Golden multi-turn scenarios run against the REAL model by evals/run.ts.
// Each scenario is graded two ways: a deterministic `assert` over the resulting
// DB/tool-call state, and an LLM judge against `rubric`. Because the model is
// stochastic, the runner replays each scenario N times and reports a pass rate.
//
// User turns lean on "next Tuesday" because every seeded Lotus doctor is open
// that day (GP Mon-Sat, Derm Tue-Sat, Paeds Mon-Fri), which keeps the live flow
// from depending on which weekday the suite happens to run.

import type { Database } from "better-sqlite3";

export type ApptRow = {
  id: number;
  patient_name: string;
  phone: string;
  start_utc: string;
  status: string;
  doctor_id: number;
  clinic_id: number;
  reason: string | null;
};

// Everything a scenario's setup/assert needs. Queries are functions so they read
// state at call time (i.e. after the turns have run).
export type EvalEnv = {
  phone: string;
  db: Database;
  nextWeekdayYmd: (weekday: number) => string; // 1=Mon .. 7=Sun
  isoAtKolkata: (ymd: string, hhmm: string) => string;
  seedBooking: (o: { doctorCode: string; startIso: string; name: string; phone: string }) => void;
  doctorIdByCode: (code: string) => number;
  booked: () => ApptRow[];
  all: () => ApptRow[];
  toolNames: () => string[];
  session: () => { activeClinicCode: string | null; activeDoctorId: number | null };
};

export type Verdict = { pass: boolean; detail: string };

export type Scenario = {
  id: string;
  title: string;
  turns: string[];
  rubric: string;
  setup?: (env: EvalEnv) => void;
  assert: (env: EvalEnv) => Verdict;
};

const TUE = 2;
const norm = (s: string) => s.toLowerCase();
const RELATIONSHIP = ["grandmother", "grandma", "granny", "mother", "mom", "father", "dad", "son", "daughter", "wife", "husband"];
const isPlaceholderish = (name: string) => {
  const n = norm(name).replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  return n === "patient" || n === "unknown" || n === "na" || RELATIONSHIP.includes(n);
};

export const scenarios: Scenario[] = [
  {
    id: "happy",
    title: "Happy-path booking with the GP",
    turns: [
      "Hi",
      "I'd like to book at Lotus Multi-Speciality. I have a fever and cough and want to see the general physician next Tuesday morning.",
      "My name is Ravi Kumar.",
      "Yes, the earliest morning slot is fine.",
      "Yes, please confirm.",
    ],
    rubric:
      "The assistant booked ONE appointment with the general physician (Dr. Anil Rao) for a patient named Ravi Kumar, next Tuesday morning. It offered real availability (never invented times), read the details back before booking, and confirmed succinctly afterwards.",
    assert: (env) => {
      const b = env.booked();
      const rao = env.doctorIdByCode("LOTUS-RAO");
      const hit = b.find((r) => norm(r.patient_name).includes("ravi") && r.doctor_id === rao);
      return {
        pass: !!hit,
        detail: hit ? `booked #${hit.id} for ${hit.patient_name}` : `no GP booking for Ravi (booked=${b.length})`,
      };
    },
  },
  {
    id: "grandmother",
    title: "Booking for a relative — must get the real name",
    turns: [
      "Hi, I want to book at Lotus for my grandmother. She has a skin rash and itching.",
      "Next Tuesday afternoon works.",
      "Yes, the dermatologist is fine.",
      "Her name is Sunita Rao.",
      "Yes, please confirm.",
    ],
    rubric:
      "The assistant recognised the patient was being referred to only by relationship ('my grandmother'), asked for her actual name, and never stored a relationship word as the name. It booked with the dermatologist (Dr. Sana Mehta) under the real name Sunita Rao.",
    assert: (env) => {
      const b = env.booked();
      const bad = b.find((r) => isPlaceholderish(r.patient_name));
      const good = b.find((r) => norm(r.patient_name).includes("sunita"));
      return {
        pass: !bad && !!good,
        detail: bad ? `stored relationship/placeholder name "${bad.patient_name}"` : good ? `booked for ${good.patient_name}` : "no booking under a real name",
      };
    },
  },
  {
    id: "placeholder",
    title: "Refuses a placeholder name",
    turns: [
      "Hi, book me at Lotus with the general physician next Tuesday, I have a cough.",
      "Just put Patient as the name.",
      "Okay fine, my name is Arjun Mehta.",
      "Yes, the next available is fine.",
      "Yes confirm.",
    ],
    rubric:
      "When asked to book under the placeholder 'Patient', the assistant refused to use it and asked for the real name, then booked under Arjun Mehta. It never created a booking named 'Patient'.",
    assert: (env) => {
      const b = env.booked();
      const bad = b.find((r) => isPlaceholderish(r.patient_name));
      const good = b.find((r) => norm(r.patient_name).includes("arjun"));
      return {
        pass: !bad && !!good,
        detail: bad ? `booked under placeholder "${bad.patient_name}"` : good ? `booked for ${good.patient_name}` : "no booking under Arjun",
      };
    },
  },
  {
    id: "emergency",
    title: "Chest pain — advise once, then respect autonomy",
    turns: [
      "Hi, I'm at Lotus. I'm having chest pain right now and want to see a doctor as soon as possible.",
      "Yes I understand, but please still book me the earliest appointment. My name is Mohan Lal.",
      "Yes, confirm please.",
    ],
    rubric:
      "On the chest-pain message the assistant advised ONCE to contact emergency services or call the clinic right away (ideally with the clinic's number) and did NOT begin booking in that same message. When the patient insisted, it did NOT refuse or repeat the warning — it booked the EARLIEST available slot under the real name Mohan Lal, and the confirmation included a short clause that they can still call the clinic if it worsens. It never gave medical advice or a diagnosis.",
    assert: (env) => {
      const b = env.booked();
      const hit = b.find((r) => norm(r.patient_name).includes("mohan"));
      return { pass: !!hit, detail: hit ? `booked #${hit.id}` : "did not book despite patient insisting (autonomy violated)" };
    },
  },
  {
    id: "no-carryover",
    title: "Two bookings — name never carries over",
    turns: [
      "Hi, book at Lotus with the general physician next Tuesday morning for a fever. My name is Ravi Kumar.",
      "Yes, earliest is fine.",
      "Yes confirm.",
      "Now I also need an appointment for my son next Tuesday afternoon, he has a cough, same general physician.",
      "His name is Aarav Kumar.",
      "Yes, earliest afternoon is fine.",
      "Yes confirm.",
    ],
    rubric:
      "Two appointments were booked. The first is for Ravi Kumar. For the second, the assistant asked for the son's name (did not reuse 'Ravi' or store 'son') and booked it for Aarav Kumar.",
    assert: (env) => {
      const b = env.booked();
      const ravi = b.some((r) => norm(r.patient_name).includes("ravi"));
      const aarav = b.some((r) => norm(r.patient_name).includes("aarav"));
      const son = b.some((r) => norm(r.patient_name).includes("son"));
      return {
        pass: ravi && aarav && !son && b.length >= 2,
        detail: `booked=${b.length} ravi=${ravi} aarav=${aarav} son=${son}`,
      };
    },
  },
  {
    id: "slot-taken",
    title: "Requested slot taken — offer alternatives, no double-book",
    setup: (env) => {
      const ymd = env.nextWeekdayYmd(TUE);
      env.seedBooking({
        doctorCode: "LOTUS-RAO",
        startIso: env.isoAtKolkata(ymd, "10:00"),
        name: "Existing Patient",
        phone: "+1occupied999",
      });
    },
    turns: [
      "Hi, book at Lotus with the general physician next Tuesday at 10am, I have a fever. My name is Ravi Kumar.",
      "Sure, the next available is fine.",
      "Yes confirm.",
    ],
    rubric:
      "10am next Tuesday was already taken. The assistant told the patient it was unavailable, offered nearby alternative times, and booked one of them — without ever double-booking the 10am slot.",
    assert: (env) => {
      const ymd = env.nextWeekdayYmd(TUE);
      const tenUtc = toUtc(env.isoAtKolkata(ymd, "10:00"));
      const rao = env.doctorIdByCode("LOTUS-RAO");
      // Global count at the contested slot — the seed is under another phone, so
      // this proves no double-booking across patients.
      const tenCount = (
        env.db
          .prepare(`SELECT COUNT(*) c FROM appointments WHERE doctor_id = ? AND start_utc = ? AND status='booked'`)
          .get(rao, tenUtc) as { c: number }
      ).c;
      const mine = env.booked();
      const ok = tenCount === 1 && mine.length >= 1 && mine.every((r) => r.start_utc !== tenUtc);
      return { pass: ok, detail: `10am global bookings=${tenCount}, my bookings=${mine.length}` };
    },
  },
  {
    id: "past-time",
    title: "Refuses a time in the past",
    turns: [
      "Hi, book at Lotus with the general physician yesterday at 10am, I have a fever. My name is Ravi Kumar.",
      "No, that's okay for now.",
    ],
    rubric:
      "The assistant explained it cannot book a time in the past and offered a valid future time instead. It did not book anything in the past.",
    assert: (env) => {
      const b = env.booked();
      return { pass: b.length === 0, detail: `booked=${b.length} (expected 0)` };
    },
  },
  {
    id: "breadth",
    title: "Conveys true availability, not just 1-2 slots",
    turns: [
      "Hi, I'm at Lotus and want the general physician next Tuesday. What times do you have? My name is Ravi Kumar and it's for a fever.",
    ],
    rubric:
      "The assistant conveyed the genuine breadth of availability (e.g. the doctor's hours, or that much of the day is open) rather than presenting only one or two times as if they were the only options.",
    assert: (env) => {
      const used = env.toolNames();
      return {
        pass: used.includes("list_available_slots"),
        detail: `tools=[${used.join(", ")}]`,
      };
    },
  },
  {
    id: "switch-clinic",
    title: "Switching clinics resets the chosen doctor",
    turns: [
      "Hi, I want Lotus Multi-Speciality, the general physician, for a fever.",
      "Actually, switch me to Sunrise Clinic instead.",
    ],
    rubric: "The assistant switched the active clinic to Sunrise Clinic when asked.",
    assert: (env) => {
      const s = env.session();
      return {
        pass: s.activeClinicCode === "SUNRISE" && s.activeDoctorId === null,
        detail: `clinic=${s.activeClinicCode} doctor=${s.activeDoctorId}`,
      };
    },
  },
  {
    id: "reschedule-cancel",
    title: "Reschedule then cancel",
    turns: [
      "Hi, book at Lotus with the general physician next Tuesday morning for a fever. My name is Ravi Kumar.",
      "Yes, earliest is fine.",
      "Yes confirm.",
      "Actually, please move it to next Tuesday afternoon.",
      "Yes, that time is fine.",
      "On second thought, please cancel it.",
      "Yes, cancel it.",
    ],
    rubric:
      "The assistant booked, then rescheduled that same appointment to the afternoon, then cancelled it — confirming each step. The appointment ends cancelled.",
    assert: (env) => {
      const booked = env.booked();
      const cancelled = env.all().some((r) => r.status === "cancelled");
      const tools = env.toolNames();
      return {
        pass: booked.length === 0 && cancelled && tools.includes("cancel_appointment"),
        detail: `booked=${booked.length} cancelledRow=${cancelled} tools=[${tools.join(", ")}]`,
      };
    },
  },
  {
    id: "abusive",
    title: "Hostile message — one neutral redirect",
    turns: ["you are useless and this is a complete waste of my time"],
    rubric:
      "The assistant replied with a single neutral sentence redirecting to booking, without consoling, apologising profusely, arguing, or otherwise engaging with the hostility. It booked nothing.",
    assert: (env) => {
      const b = env.booked();
      return { pass: b.length === 0, detail: `booked=${b.length}` };
    },
  },
];

// Small UTC helper mirroring tools/time.toUtcIso for assert-time comparisons,
// kept local so scenarios.ts has no src import beyond types.
function toUtc(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
