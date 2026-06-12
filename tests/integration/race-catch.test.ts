import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DateTime } from "luxon";

// Force createAppointment past its pre-check so the INSERT itself collides with
// the unique index — this is the genuine race (a competitor wins the slot
// between check and insert), which synchronous SQLite can't reproduce on its
// own. We mock checkSlotAvailable: "free" on the pre-check, then "taken + alts"
// when the catch re-queries for alternatives.
vi.mock("../../src/tools/slots", () => ({ checkSlotAvailable: vi.fn() }));

import { createAppointment } from "../../src/tools/appointments";
import { checkSlotAvailable } from "../../src/tools/slots";
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

const mockCheck = vi.mocked(checkSlotAvailable);

describe("createAppointment race-catch branch", () => {
  let restore: () => void;
  beforeEach(() => {
    resetDynamicData();
    mockCheck.mockReset();
    restore = freezeNow();
  });
  afterEach(() => restore?.());

  it("returns 'Slot was just taken.' with alternatives when the insert loses the race", () => {
    const d = doctor("LOTUS-RAO");
    const start = DateTime.fromISO(`${MONDAY}T11:00`, { zone: ANCHOR_ZONE });
    const startUtc = toUtcIso(start);

    // A competitor already holds the slot at the DB level.
    seedBooking({
      doctorId: d.id,
      clinicId: lotus().id,
      phone: "+1winner",
      name: "Winner",
      startUtc,
      endUtc: toUtcIso(endOfSlot(start, d)),
    });

    mockCheck
      .mockReturnValueOnce({ available: true }) // pre-check passes (stale read)
      .mockReturnValue({ available: false, alternatives: [{ start_iso: "x", label: "11:30 AM" }] });

    const phone = "+1loser";
    appendUser(phone, "book for Ravi");
    const res = createAppointment({ phone, clinic: lotus() }, d, {
      patient_name: "Ravi",
      start_iso: start.toISO()!,
    });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/just taken/i);
    expect(res.alternatives?.length).toBe(1);
    // Still exactly one booked row at the slot — the loser never persisted.
    const c = db
      .prepare(`SELECT COUNT(*) c FROM appointments WHERE doctor_id = ? AND start_utc = ? AND status='booked'`)
      .get(d.id, startUtc) as any;
    expect(c.c).toBe(1);
  });
});
