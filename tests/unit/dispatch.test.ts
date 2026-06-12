import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DateTime } from "luxon";
import { dispatchTool } from "../../src/tools";
import { appendUser } from "../../src/session";
import { db } from "../../src/db";
import { ANCHOR_ZONE, MONDAY, freezeNow, resetDynamicData } from "../helpers";

function iso(hhmm: string): string {
  return DateTime.fromISO(`${MONDAY}T${hhmm}`, { zone: ANCHOR_ZONE }).toISO()!;
}
const j = (o: unknown) => JSON.stringify(o);

describe("dispatchTool", () => {
  let restore: () => void;
  beforeEach(() => {
    resetDynamicData();
    restore = freezeNow();
  });
  afterEach(() => restore?.());

  it("returns an error for malformed JSON arguments", () => {
    const res = dispatchTool("select_clinic", "{not json", "+1") as any;
    expect(res.error).toMatch(/invalid json/i);
  });

  it("lists clinics without requiring a selected clinic", () => {
    const res = dispatchTool("list_clinics", "{}", "+1") as any;
    expect(res.clinics.map((c: any) => c.code)).toEqual(
      expect.arrayContaining(["LOTUS", "SUNRISE", "HARBOR"]),
    );
  });

  it("gates clinic-scoped tools behind clinic selection", () => {
    const res = dispatchTool("list_doctors", "{}", "+1") as any;
    expect(res.error).toMatch(/no clinic selected/i);
  });

  it("select_clinic rejects an unknown code and accepts a real one", () => {
    expect((dispatchTool("select_clinic", j({ code: "NOPE" }), "+1") as any).ok).toBe(false);
    const ok = dispatchTool("select_clinic", j({ code: "LOTUS" }), "+1") as any;
    expect(ok.ok).toBe(true);
    expect(ok.clinic.code).toBe("LOTUS");
  });

  it("gates doctor-scoped tools behind doctor selection", () => {
    dispatchTool("select_clinic", j({ code: "LOTUS" }), "+2");
    const res = dispatchTool("list_available_slots", j({ date: MONDAY }), "+2") as any;
    expect(res.error).toMatch(/no doctor selected/i);
  });

  it("select_doctor rejects an unknown code and accepts a real one at the active clinic", () => {
    dispatchTool("select_clinic", j({ code: "LOTUS" }), "+3");
    expect((dispatchTool("select_doctor", j({ code: "NOPE" }), "+3") as any).ok).toBe(false);
    const ok = dispatchTool("select_doctor", j({ code: "LOTUS-RAO" }), "+3") as any;
    expect(ok.ok).toBe(true);
    expect(ok.doctor.code).toBe("LOTUS-RAO");
  });

  it("returns an error for an unknown tool name", () => {
    dispatchTool("select_clinic", j({ code: "LOTUS" }), "+4");
    const res = dispatchTool("totally_made_up", "{}", "+4") as any;
    expect(res.error).toMatch(/unknown tool/i);
  });

  it("ignores any phone passed in tool args — ownership comes from the session phone", () => {
    const phone = "+15557777";
    dispatchTool("select_clinic", j({ code: "LOTUS" }), phone);
    dispatchTool("select_doctor", j({ code: "LOTUS-RAO" }), phone);
    appendUser(phone, "book for Ravi");
    // Smuggle a different phone in the args; it must be ignored.
    const res = dispatchTool(
      "create_appointment",
      j({ patient_name: "Ravi", start_iso: iso("11:00"), phone: "+10000000000" }),
      phone,
    ) as any;
    expect(res.ok).toBe(true);
    const row = db.prepare(`SELECT phone FROM appointments WHERE id = ?`).get(res.appointment.id) as any;
    expect(row.phone).toBe(phone); // booked under the session phone, not the smuggled one
  });
});
