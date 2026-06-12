import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DateTime } from "luxon";
import { adminCreateAppointment } from "../../src/admin-appointments";
import { db } from "../../src/db";
import { ANCHOR_ZONE, MONDAY, doctor, lotus, freezeNow, resetDynamicData } from "../helpers";

function iso(hhmm: string): string {
  return DateTime.fromISO(`${MONDAY}T${hhmm}`, { zone: ANCHOR_ZONE }).toISO()!;
}

describe("adminCreateAppointment — name parity with the agent", () => {
  let restore: () => void;
  beforeEach(() => {
    resetDynamicData();
    restore = freezeNow();
  });
  afterEach(() => restore?.());

  it("rejects a placeholder/relationship name just like the agent path", () => {
    const res = adminCreateAppointment(lotus().id, {
      patient_name: "Patient",
      phone: "+15551234",
      start_iso: iso("11:00"),
      doctor_id: doctor("LOTUS-RAO").id,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/valid patient name/i);
    expect((db.prepare(`SELECT COUNT(*) c FROM appointments`).get() as any).c).toBe(0);
  });

  it("still books a real name (no grounding requirement on the admin path)", () => {
    const res = adminCreateAppointment(lotus().id, {
      patient_name: "Ravi Kumar",
      phone: "+15551234",
      start_iso: iso("11:00"),
      doctor_id: doctor("LOTUS-RAO").id,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.appointment.patient_name).toBe("Ravi Kumar");
  });
});
