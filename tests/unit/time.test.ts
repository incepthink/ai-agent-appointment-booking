import { describe, it, expect, afterEach } from "vitest";
import { DateTime } from "luxon";
import {
  isClinicOpenDay,
  isOnSlotGrid,
  isWithinClinicHours,
  nowInClinicTz,
  parseIsoToClinic,
  slotsForDate,
  toUtcIso,
  type Schedule,
} from "../../src/tools/time";
import type { Day } from "../../src/clinics";
import { ANCHOR_ZONE, MONDAY, SUNDAY, doctor, freezeNow } from "../helpers";

// Helper: build a DateTime at a local wall-clock time on the anchor Monday.
function at(hhmm: string, zone = ANCHOR_ZONE, ymd = MONDAY): DateTime {
  return DateTime.fromISO(`${ymd}T${hhmm}`, { zone });
}

describe("time.ts — schedule math", () => {
  let restore: () => void;
  afterEach(() => restore?.());

  describe("isClinicOpenDay", () => {
    it("is true on a working day and false on a closed day", () => {
      const rao = doctor("LOTUS-RAO"); // Mon-Sat
      expect(isClinicOpenDay(at("10:00"), rao)).toBe(true); // Monday
      expect(isClinicOpenDay(at("10:00", ANCHOR_ZONE, SUNDAY), rao)).toBe(false); // Sunday
    });
  });

  describe("isWithinClinicHours", () => {
    const rao = () => doctor("LOTUS-RAO"); // 09:00-17:00

    it("accepts a slot fully inside hours", () => {
      restore = freezeNow();
      expect(isWithinClinicHours(at("09:00"), rao())).toBe(true);
      expect(isWithinClinicHours(at("16:30"), rao())).toBe(true); // ends exactly at 17:00
    });

    it("rejects a slot starting before open or ending after close", () => {
      restore = freezeNow();
      expect(isWithinClinicHours(at("08:30"), rao())).toBe(false);
      // A slot starting exactly at close would end after close -> invalid.
      expect(isWithinClinicHours(at("17:00"), rao())).toBe(false);
    });

    it("rejects any time on a closed day", () => {
      restore = freezeNow();
      expect(isWithinClinicHours(at("10:00", ANCHOR_ZONE, SUNDAY), rao())).toBe(false);
    });
  });

  describe("isOnSlotGrid", () => {
    it("accepts grid-aligned times and rejects off-grid / sub-minute times", () => {
      const rao = doctor("LOTUS-RAO"); // 30-min grid from 09:00
      expect(isOnSlotGrid(at("09:00"), rao)).toBe(true);
      expect(isOnSlotGrid(at("09:30"), rao)).toBe(true);
      expect(isOnSlotGrid(at("09:15"), rao)).toBe(false);
      expect(isOnSlotGrid(at("09:00:30"), rao)).toBe(false); // non-zero seconds
    });

    it("documents behaviour when clinic open time is itself off a round grid (09:07)", () => {
      const odd: Schedule = {
        tz: ANCHOR_ZONE,
        open: "09:07",
        close: "17:00",
        days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as Day[],
        slotMinutes: 30,
      };
      // The grid is anchored to the (odd) open time, so 09:07 is on-grid and a
      // round 09:00 is not. This is the current, intentional behaviour.
      expect(isOnSlotGrid(at("09:07"), odd)).toBe(true);
      expect(isOnSlotGrid(at("09:37"), odd)).toBe(true);
      expect(isOnSlotGrid(at("09:00"), odd)).toBe(false);
    });
  });

  describe("slotsForDate", () => {
    it("generates the full grid for an open day (GP: 16 slots, 09:00-16:30)", () => {
      restore = freezeNow(); // Monday 07:00, before open
      const slots = slotsForDate(MONDAY, doctor("LOTUS-RAO"));
      expect(slots.length).toBe(16);
      expect(slots[0].toFormat("HH:mm")).toBe("09:00");
      expect(slots[slots.length - 1].toFormat("HH:mm")).toBe("16:30");
    });

    it("respects a doctor's shorter hours (Paeds: 8 slots, 09:00-12:30)", () => {
      restore = freezeNow();
      const slots = slotsForDate(MONDAY, doctor("LOTUS-IYER"));
      expect(slots.length).toBe(8);
      expect(slots[slots.length - 1].toFormat("HH:mm")).toBe("12:30");
    });

    it("returns no slots on a doctor's closed day (Derm closed Monday)", () => {
      restore = freezeNow();
      expect(slotsForDate(MONDAY, doctor("LOTUS-MEHTA"))).toEqual([]);
    });

    it("drops slots at or before 'now' so today never offers a past time", () => {
      restore = freezeNow("2026-06-15T10:15:00"); // mid-morning Monday
      const slots = slotsForDate(MONDAY, doctor("LOTUS-RAO"));
      // 09:00, 09:30, 10:00 are all <= now and filtered; first remaining is 10:30.
      expect(slots[0].toFormat("HH:mm")).toBe("10:30");
      expect(slots.every((s) => s.toMillis() > DateTime.fromISO("2026-06-15T10:15:00", { zone: ANCHOR_ZONE }).toMillis())).toBe(true);
    });

    it("returns [] for an invalid date string", () => {
      restore = freezeNow();
      expect(slotsForDate("not-a-date", doctor("LOTUS-RAO"))).toEqual([]);
    });
  });

  describe("nowInClinicTz", () => {
    it("returns the frozen instant in the schedule's zone", () => {
      restore = freezeNow("2026-06-15T07:00:00");
      const now = nowInClinicTz(doctor("LOTUS-RAO"));
      expect(now.zoneName).toBe(ANCHOR_ZONE);
      expect(now.toFormat("yyyy-LL-dd HH:mm")).toBe("2026-06-15 07:00");
    });
  });

  describe("UTC round-trip", () => {
    it("parseIsoToClinic(toUtcIso(dt)) preserves the instant", () => {
      const rao = doctor("LOTUS-RAO");
      const dt = at("14:30");
      const back = parseIsoToClinic(toUtcIso(dt), rao);
      expect(back.toMillis()).toBe(dt.toMillis());
    });
  });

  describe("DST correctness (America/New_York)", () => {
    // 2026 US spring-forward is Mar 8. Same wall-clock 10:00 maps to a different
    // UTC offset before (EST, -05:00) and after (EDT, -04:00). Luxon handles it;
    // this pins that the conversion stays correct across the boundary.
    const ny: Schedule = {
      tz: "America/New_York",
      open: "08:00",
      close: "16:00",
      days: ["Mon", "Tue", "Wed", "Thu", "Fri"] as Day[],
      slotMinutes: 30,
    };

    it("maps 10:00 local to the right UTC instant on each side of DST", () => {
      const beforeDst = DateTime.fromISO("2026-03-02T10:00:00", { zone: ny.tz }); // EST
      const afterDst = DateTime.fromISO("2026-03-16T10:00:00", { zone: ny.tz }); // EDT
      expect(toUtcIso(beforeDst)).toBe("2026-03-02T15:00:00Z");
      expect(toUtcIso(afterDst)).toBe("2026-03-16T14:00:00Z");
    });
  });
});
