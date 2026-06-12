import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DateTime } from "luxon";
import { createAppointment, rescheduleAppointment } from "../../src/tools/appointments";
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
function book(phone: string, doctorCode: string, hhmm: string) {
  appendUser(phone, "book for Ravi");
  return createAppointment({ phone, clinic: lotus() }, doctor(doctorCode), {
    patient_name: "Ravi",
    start_iso: iso(hhmm),
  });
}
function bookedCountAt(doctorId: number, startUtc: string): number {
  return (
    db
      .prepare(`SELECT COUNT(*) c FROM appointments WHERE doctor_id = ? AND start_utc = ? AND status='booked'`)
      .get(doctorId, startUtc) as any
  ).c;
}

describe("double-booking & integrity", () => {
  let restore: () => void;
  beforeEach(() => {
    resetDynamicData();
    restore = freezeNow();
  });
  afterEach(() => restore?.());

  it("two patients booking the same doctor+slot: exactly one wins", () => {
    const a = book("+1aaa", "LOTUS-RAO", "11:00");
    const b = book("+1bbb", "LOTUS-RAO", "11:00");
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(b.alternatives?.length).toBeGreaterThan(0);
    const startUtc = toUtcIso(DateTime.fromISO(`${MONDAY}T11:00`, { zone: ANCHOR_ZONE }));
    expect(bookedCountAt(doctor("LOTUS-RAO").id, startUtc)).toBe(1);
  });

  it("two different doctors CAN share the same wall-clock slot", () => {
    const a = book("+1ccc", "LOTUS-RAO", "11:00");
    const b = book("+1ddd", "LOTUS-IYER", "11:00"); // Paeds open 09:00-13:00
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const startUtc = toUtcIso(DateTime.fromISO(`${MONDAY}T11:00`, { zone: ANCHOR_ZONE }));
    expect(bookedCountAt(doctor("LOTUS-RAO").id, startUtc)).toBe(1);
    expect(bookedCountAt(doctor("LOTUS-IYER").id, startUtc)).toBe(1);
  });

  it("rescheduling into a taken slot fails and leaves the original untouched", () => {
    const a = book("+1eee", "LOTUS-RAO", "11:00");
    const b = book("+1fff", "LOTUS-RAO", "12:00");
    expect(a.ok && b.ok).toBe(true);
    const res = rescheduleAppointment(
      { phone: "+1fff", clinic: lotus() },
      { appointment_id: b.appointment!.id, new_start_iso: iso("11:00") },
    );
    expect(res.ok).toBe(false);
    const row = db.prepare(`SELECT start_utc FROM appointments WHERE id = ?`).get(b.appointment!.id) as any;
    expect(row.start_utc).toBe(toUtcIso(DateTime.fromISO(`${MONDAY}T12:00`, { zone: ANCHOR_ZONE })));
  });

  it("the partial unique index backstops a true race at the DB level", () => {
    const d = doctor("LOTUS-RAO");
    const start = DateTime.fromISO(`${MONDAY}T11:00`, { zone: ANCHOR_ZONE });
    const args = {
      doctorId: d.id,
      clinicId: lotus().id,
      phone: "+1ggg",
      name: "Ravi",
      startUtc: toUtcIso(start),
      endUtc: toUtcIso(endOfSlot(start, d)),
    };
    seedBooking(args);
    // A second booked row for the same (doctor_id, start_utc) must be rejected by
    // uq_active_slot — this is the guarantee createAppointment's catch relies on.
    expect(() => seedBooking(args)).toThrow(/UNIQUE/);
  });
});
