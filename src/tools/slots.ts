import { DateTime } from "luxon";
import { db } from "../db";
import type { Clinic } from "../clinics";
import {
  humanLocal,
  isClinicOpenDay,
  isOnSlotGrid,
  isWithinClinicHours,
  nowInClinicTz,
  parseIsoToClinic,
  slotsForDate,
  toUtcIso,
  endOfSlot,
} from "./time";

type PartOfDay = "morning" | "afternoon" | "evening";

function filterByPart(slot: DateTime, clinic: Clinic, part?: PartOfDay): boolean {
  if (!part) return true;
  const h = slot.setZone(clinic.tz).hour;
  if (part === "morning") return h < 12;
  if (part === "afternoon") return h >= 12 && h < 16;
  return h >= 16;
}

function bookedSet(clinic: Clinic, dateYmd: string): Set<string> {
  const start = DateTime.fromISO(dateYmd, { zone: clinic.tz }).startOf("day");
  const end = start.plus({ days: 1 });
  const rows = db
    .prepare(
      `SELECT start_utc FROM appointments
       WHERE clinic_id = ? AND status = 'booked' AND start_utc >= ? AND start_utc < ?`,
    )
    .all(clinic.id, toUtcIso(start), toUtcIso(end)) as { start_utc: string }[];
  return new Set(rows.map((r) => r.start_utc));
}

export function listAvailableSlots(
  clinic: Clinic,
  args: { date: string; part_of_day?: PartOfDay },
): {
  date: string;
  open: boolean;
  slots: { start_iso: string; label: string }[];
  message?: string;
} {
  const date = args.date;
  const dt = DateTime.fromISO(date, { zone: clinic.tz });
  if (!dt.isValid) {
    return { date, open: false, slots: [], message: "Invalid date format. Use YYYY-MM-DD." };
  }
  if (!isClinicOpenDay(dt, clinic)) {
    return {
      date,
      open: false,
      slots: [],
      message: `Clinic is closed on ${dt.toFormat("cccc")}. Open days: ${clinic.days.join(", ")}.`,
    };
  }
  const all = slotsForDate(date, clinic);
  const booked = bookedSet(clinic, date);
  const available = all
    .filter((s) => !booked.has(toUtcIso(s)))
    .filter((s) => filterByPart(s, clinic, args.part_of_day))
    .map((s) => ({ start_iso: toUtcIso(s), label: humanLocal(s, clinic) }));

  return {
    date,
    open: true,
    slots: available,
    message: available.length === 0 ? "No slots available for that day/part." : undefined,
  };
}

export function checkSlotAvailable(
  clinic: Clinic,
  args: { start_iso: string },
): {
  available: boolean;
  reason?: string;
  alternatives?: { start_iso: string; label: string }[];
} {
  const dt = parseIsoToClinic(args.start_iso, clinic);
  if (!dt.isValid) return { available: false, reason: "Invalid datetime." };
  if (dt <= nowInClinicTz(clinic)) return { available: false, reason: "That time is in the past." };
  if (!isWithinClinicHours(dt, clinic)) {
    const ymd = dt.toFormat("yyyy-LL-dd");
    const allSlots = slotsForDate(ymd, clinic);
    const booked = bookedSet(clinic, ymd);
    const free = allSlots
      .filter((s) => !booked.has(toUtcIso(s)))
      .map((s) => ({ start_iso: toUtcIso(s), label: humanLocal(s, clinic) }));

    return {
      available: false,
      reason: `Outside clinic hours (${clinic.open}–${clinic.close}, ${clinic.days.join(", ")}).`,
      alternatives: free,
    };
  }
  if (!isOnSlotGrid(dt, clinic)) {
    return {
      available: false,
      reason: `Times must align to ${clinic.slotMinutes}-minute slots from ${clinic.open}.`,
    };
  }
  const startUtc = toUtcIso(dt);
  const clash = db
    .prepare(`SELECT 1 FROM appointments WHERE clinic_id = ? AND status='booked' AND start_utc = ?`)
    .get(clinic.id, startUtc);
  if (!clash) return { available: true };

  // suggest nearest alternatives same day
  const ymd = dt.toFormat("yyyy-LL-dd");
  const all = slotsForDate(ymd, clinic);
  const booked = bookedSet(clinic, ymd);
  const free = all
    .filter((s) => !booked.has(toUtcIso(s)))
    .map((s) => ({ slot: s, diff: Math.abs(s.toMillis() - dt.toMillis()) }))
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 3)
    .map((x) => ({ start_iso: toUtcIso(x.slot), label: humanLocal(x.slot, clinic) }));

  return {
    available: false,
    reason: "That slot is already booked.",
    alternatives: free,
  };
}

export { endOfSlot, toUtcIso, humanLocal };
