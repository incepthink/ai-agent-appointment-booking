import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DateTime } from "luxon";
import { checkSlotAvailable, listAvailableSlots } from "../../src/tools/slots";
import { createAppointment } from "../../src/tools/appointments";
import { appendUser } from "../../src/session";
import { db } from "../../src/db";
import { ANCHOR_ZONE, MONDAY, doctor, lotus, freezeNow, resetDynamicData } from "../helpers";

describe("hardening: far-future cap & doctor-active recheck", () => {
  let restore: () => void;
  beforeEach(() => {
    resetDynamicData();
    restore = freezeNow();
  });
  afterEach(() => {
    restore?.();
    db.exec(`UPDATE doctors SET active = 1`); // undo any deactivation
  });

  describe("far-future date cap (365 days)", () => {
    const farYmd = DateTime.fromISO(MONDAY, { zone: ANCHOR_ZONE }).plus({ days: 400 }).toFormat("yyyy-LL-dd");
    const farIso = DateTime.fromISO(`${farYmd}T10:00`, { zone: ANCHOR_ZONE }).toISO()!;

    it("listAvailableSlots refuses dates beyond the horizon", () => {
      const res = listAvailableSlots(doctor("LOTUS-RAO"), { date: farYmd });
      expect(res.open).toBe(false);
      expect(res.message).toMatch(/365 days/);
    });

    it("checkSlotAvailable refuses times beyond the horizon", () => {
      const res = checkSlotAvailable(doctor("LOTUS-RAO"), { start_iso: farIso });
      expect(res.available).toBe(false);
      expect(res.reason).toMatch(/beyond|365/i);
    });
  });

  describe("doctor deactivated between selection and booking", () => {
    it("refuses to book against a now-inactive doctor", () => {
      const phone = "+1stale";
      const d = doctor("LOTUS-RAO"); // captured while active (mirrors a stale session)
      db.prepare(`UPDATE doctors SET active = 0 WHERE id = ?`).run(d.id);
      appendUser(phone, "book for Ravi");
      const start = DateTime.fromISO(`${MONDAY}T11:00`, { zone: ANCHOR_ZONE }).toISO()!;
      const res = createAppointment({ phone, clinic: lotus() }, d, { patient_name: "Ravi", start_iso: start });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/no longer available/i);
      expect((db.prepare(`SELECT COUNT(*) c FROM appointments`).get() as any).c).toBe(0);
    });
  });
});
