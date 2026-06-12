import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DateTime } from "luxon";
import { checkSlotAvailable, listAvailableSlots } from "../../src/tools/slots";
import { toUtcIso, endOfSlot } from "../../src/tools/time";
import {
  ANCHOR_ZONE,
  MONDAY,
  doctor,
  lotus,
  freezeNow,
  resetDynamicData,
  seedBooking,
} from "../helpers";

// Build an ISO start string (with zone offset) for a wall-clock time on Monday.
function iso(hhmm: string): string {
  return DateTime.fromISO(`${MONDAY}T${hhmm}`, { zone: ANCHOR_ZONE }).toISO()!;
}

describe("slots.ts", () => {
  let restore: () => void;
  beforeEach(() => {
    resetDynamicData();
    restore = freezeNow(); // Monday 07:00 IST
  });
  afterEach(() => restore?.());

  describe("listAvailableSlots", () => {
    it("returns the full day with count and first/last labels", () => {
      const res = listAvailableSlots(doctor("LOTUS-RAO"), { date: MONDAY });
      expect(res.open).toBe(true);
      expect(res.count).toBe(16);
      expect(res.first_label).toMatch(/9:00 AM/);
      expect(res.last_label).toMatch(/4:30 PM/);
    });

    it("reports a closed day instead of inventing slots", () => {
      const res = listAvailableSlots(doctor("LOTUS-MEHTA"), { date: MONDAY }); // Derm closed Mon
      expect(res.open).toBe(false);
      expect(res.count).toBe(0);
      expect(res.message).toMatch(/not available/i);
    });

    it("rejects an invalid date format", () => {
      const res = listAvailableSlots(doctor("LOTUS-RAO"), { date: "15-06-2026" });
      expect(res.open).toBe(false);
      expect(res.message).toMatch(/invalid date/i);
    });

    it("filters by part of day", () => {
      const rao = doctor("LOTUS-RAO");
      expect(listAvailableSlots(rao, { date: MONDAY, part_of_day: "morning" }).count).toBe(6); // 09:00-11:30
      expect(listAvailableSlots(rao, { date: MONDAY, part_of_day: "afternoon" }).count).toBe(8); // 12:00-15:30
      expect(listAvailableSlots(rao, { date: MONDAY, part_of_day: "evening" }).count).toBe(2); // 16:00,16:30
    });

    it("excludes a slot that is already booked for that doctor", () => {
      const rao = doctor("LOTUS-RAO");
      const start = DateTime.fromISO(`${MONDAY}T10:00`, { zone: ANCHOR_ZONE });
      seedBooking({
        doctorId: rao.id,
        clinicId: lotus().id,
        phone: "+10000000000",
        name: "Seed Patient",
        startUtc: toUtcIso(start),
        endUtc: toUtcIso(endOfSlot(start, rao)),
      });
      const res = listAvailableSlots(rao, { date: MONDAY });
      expect(res.count).toBe(15);
      expect(res.slots.some((s) => s.start_iso === toUtcIso(start))).toBe(false);
    });

    it("does not leak another doctor's bookings (availability is per-doctor)", () => {
      const rao = doctor("LOTUS-RAO");
      const iyer = doctor("LOTUS-IYER");
      const start = DateTime.fromISO(`${MONDAY}T10:00`, { zone: ANCHOR_ZONE });
      seedBooking({
        doctorId: iyer.id,
        clinicId: lotus().id,
        phone: "+10000000000",
        name: "Seed Patient",
        startUtc: toUtcIso(start),
        endUtc: toUtcIso(endOfSlot(start, iyer)),
      });
      // Rao's 10:00 is untouched by Iyer's booking.
      expect(listAvailableSlots(rao, { date: MONDAY }).count).toBe(16);
    });
  });

  describe("checkSlotAvailable", () => {
    const rao = () => doctor("LOTUS-RAO");

    it("accepts a free, in-hours, on-grid slot", () => {
      expect(checkSlotAvailable(rao(), { start_iso: iso("10:00") })).toEqual({ available: true });
    });

    it("rejects a past time", () => {
      restore(); // restore real clock
      restore = freezeNow("2026-06-15T12:00:00"); // now is noon
      const res = checkSlotAvailable(rao(), { start_iso: iso("10:00") });
      expect(res.available).toBe(false);
      expect(res.reason).toMatch(/past/i);
    });

    it("rejects a time outside the doctor's hours and offers alternatives", () => {
      const res = checkSlotAvailable(rao(), { start_iso: iso("20:00") }); // after 17:00 close
      expect(res.available).toBe(false);
      expect(res.reason).toMatch(/outside/i);
      expect(Array.isArray(res.alternatives)).toBe(true);
      expect(res.alternatives!.length).toBeGreaterThan(0);
    });

    it("rejects an off-grid time", () => {
      const res = checkSlotAvailable(rao(), { start_iso: iso("10:15") });
      expect(res.available).toBe(false);
      expect(res.reason).toMatch(/align/i);
    });

    it("rejects an already-booked slot and suggests up to 3 nearby alternatives", () => {
      const d = rao();
      const start = DateTime.fromISO(`${MONDAY}T10:00`, { zone: ANCHOR_ZONE });
      seedBooking({
        doctorId: d.id,
        clinicId: lotus().id,
        phone: "+10000000000",
        name: "Seed Patient",
        startUtc: toUtcIso(start),
        endUtc: toUtcIso(endOfSlot(start, d)),
      });
      const res = checkSlotAvailable(d, { start_iso: iso("10:00") });
      expect(res.available).toBe(false);
      expect(res.reason).toMatch(/already booked/i);
      expect(res.alternatives!.length).toBeLessThanOrEqual(3);
      expect(res.alternatives!.some((a) => a.start_iso === toUtcIso(start))).toBe(false);
    });
  });
});
