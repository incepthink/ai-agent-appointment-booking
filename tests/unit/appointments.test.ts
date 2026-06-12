import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DateTime } from "luxon";
import {
  cancelAppointment,
  createAppointment,
  isPlaceholderName,
  nameIsGrounded,
  rescheduleAppointment,
} from "../../src/tools/appointments";
import { toUtcIso, endOfSlot } from "../../src/tools/time";
import { appendUser } from "../../src/session";
import { db } from "../../src/db";
import {
  ANCHOR_ZONE,
  MONDAY,
  doctor,
  lotus,
  freezeNow,
  resetDynamicData,
  seedBooking,
} from "../helpers";

function iso(hhmm: string): string {
  return DateTime.fromISO(`${MONDAY}T${hhmm}`, { zone: ANCHOR_ZONE }).toISO()!;
}
function ctx(phone: string) {
  return { phone, clinic: lotus() };
}

describe("appointments.ts", () => {
  let restore: () => void;
  beforeEach(() => {
    resetDynamicData();
    restore = freezeNow();
  });
  afterEach(() => restore?.());

  describe("isPlaceholderName", () => {
    it.each([
      "Patient", "patient", "the patient", "Patient Name", "Unknown", "N/A", "na",
      "TBD", "test", "Me", "myself", "grandmother", "Grandma", "Mom", "dad",
      "my son", "my wife",
    ])("rejects placeholder/relationship %s", (n) => {
      expect(isPlaceholderName(n)).toBe(true);
    });

    it.each(["Patience", "Sonia", "Ravi Kumar", "Mehta", "Sunita", "Dada Saheb"])(
      "accepts real name %s (even if it contains a blocked substring)",
      (n) => {
        expect(isPlaceholderName(n)).toBe(false);
      },
    );
  });

  describe("nameIsGrounded", () => {
    it("is true when a token of the name appears in the sender's text", () => {
      expect(nameIsGrounded("Ravi", "please book it for ravi tomorrow")).toBe(true);
      expect(nameIsGrounded("Ravi Kumar", "the patient is kumar")).toBe(true);
    });
    it("is false when no token of the name was typed by the sender", () => {
      expect(nameIsGrounded("Zoe", "book for my grandmother at 10")).toBe(false);
      expect(nameIsGrounded("", "anything")).toBe(false);
    });
  });

  describe("createAppointment", () => {
    it("books when the name is real and grounded in the sender's text", () => {
      const phone = "+15550001";
      appendUser(phone, "Hi, please book for Ravi");
      const res = createAppointment(ctx(phone), doctor("LOTUS-RAO"), {
        patient_name: "Ravi",
        start_iso: iso("11:00"),
        reason: "fever",
      });
      expect(res.ok).toBe(true);
      const row = db.prepare(`SELECT * FROM appointments WHERE phone = ?`).get(phone) as any;
      expect(row.patient_name).toBe("Ravi");
      expect(row.status).toBe("booked");
    });

    it("refuses a placeholder name", () => {
      const phone = "+15550002";
      appendUser(phone, "just put Patient");
      const res = createAppointment(ctx(phone), doctor("LOTUS-RAO"), {
        patient_name: "Patient",
        start_iso: iso("11:00"),
      });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/real name/i);
      expect(db.prepare(`SELECT COUNT(*) c FROM appointments`).get() as any).toEqual({ c: 0 });
    });

    it("refuses a name not grounded in this booking's messages (carry-over guard)", () => {
      const phone = "+15550003";
      appendUser(phone, "book me an appointment"); // never typed "Zoe"
      const res = createAppointment(ctx(phone), doctor("LOTUS-RAO"), {
        patient_name: "Zoe",
        start_iso: iso("11:00"),
      });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/this booking|carry/i);
    });

    it("refuses a slot already taken and surfaces alternatives", () => {
      const phone = "+15550004";
      appendUser(phone, "book for Ravi");
      const d = doctor("LOTUS-RAO");
      const start = DateTime.fromISO(`${MONDAY}T11:00`, { zone: ANCHOR_ZONE });
      seedBooking({
        doctorId: d.id,
        clinicId: lotus().id,
        phone: "+19999",
        name: "Someone Else",
        startUtc: toUtcIso(start),
        endUtc: toUtcIso(endOfSlot(start, d)),
      });
      const res = createAppointment(ctx(phone), d, { patient_name: "Ravi", start_iso: iso("11:00") });
      expect(res.ok).toBe(false);
      expect(res.alternatives?.length).toBeGreaterThan(0);
    });
  });

  describe("reschedule / cancel ownership", () => {
    function book(phone: string, hhmm: string) {
      appendUser(phone, "book for Ravi");
      const res = createAppointment(ctx(phone), doctor("LOTUS-RAO"), {
        patient_name: "Ravi",
        start_iso: iso(hhmm),
      });
      if (!res.ok) throw new Error(res.error);
      return res.appointment!.id;
    }

    it("lets the owner reschedule to a free slot", () => {
      const phone = "+15550010";
      const id = book(phone, "11:00");
      const res = rescheduleAppointment(ctx(phone), { appointment_id: id, new_start_iso: iso("12:00") });
      expect(res.ok).toBe(true);
      const row = db.prepare(`SELECT start_utc FROM appointments WHERE id = ?`).get(id) as any;
      expect(row.start_utc).toBe(toUtcIso(DateTime.fromISO(`${MONDAY}T12:00`, { zone: ANCHOR_ZONE })));
    });

    it("does NOT let another phone reschedule someone else's appointment", () => {
      const id = book("+15550011", "11:00");
      const res = rescheduleAppointment(ctx("+15550012"), {
        appointment_id: id,
        new_start_iso: iso("12:00"),
      });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not found/i);
    });

    it("lets the owner cancel and blocks others", () => {
      const phone = "+15550013";
      const id = book(phone, "11:00");
      expect(cancelAppointment(ctx("+15550014"), { appointment_id: id }).ok).toBe(false);
      const ok = cancelAppointment(ctx(phone), { appointment_id: id });
      expect(ok.ok).toBe(true);
      const row = db.prepare(`SELECT status FROM appointments WHERE id = ?`).get(id) as any;
      expect(row.status).toBe("cancelled");
    });
  });
});
