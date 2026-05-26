import { DateTime } from "luxon";
import { db } from "../db";
import { config } from "../config";
import {
  endOfSlot,
  humanLocal,
  isClinicOpenDay,
  isOnSlotGrid,
  isWithinClinicHours,
  nowInClinicTz,
  parseIsoToClinic,
  slotsForDate,
  toUtcIso,
} from "./time";

type PartOfDay = "morning" | "afternoon" | "evening";

function filterByPart(slot: DateTime, part?: PartOfDay): boolean {
  if (!part) return true;
  const h = slot.setZone(config.clinic.tz).hour;
  if (part === "morning") return h < 12;
  if (part === "afternoon") return h >= 12 && h < 16;
  return h >= 16;
}

function bookedSet(dateYmd: string): Set<string> {
  const start = DateTime.fromISO(dateYmd, { zone: config.clinic.tz }).startOf("day");
  const end = start.plus({ days: 1 });
  const rows = db
    .prepare(
      `SELECT start_utc FROM appointments
       WHERE status = 'booked' AND start_utc >= ? AND start_utc < ?`,
    )
    .all(toUtcIso(start), toUtcIso(end)) as { start_utc: string }[];
  return new Set(rows.map((r) => r.start_utc));
}

export function listAvailableSlots(args: {
  date: string;
  part_of_day?: PartOfDay;
}): {
  date: string;
  open: boolean;
  slots: { start_iso: string; label: string }[];
  message?: string;
} {
  const date = args.date;
  const dt = DateTime.fromISO(date, { zone: config.clinic.tz });
  if (!dt.isValid) {
    return { date, open: false, slots: [], message: "Invalid date format. Use YYYY-MM-DD." };
  }
  if (!isClinicOpenDay(dt)) {
    return {
      date,
      open: false,
      slots: [],
      message: `Clinic is closed on ${dt.toFormat("cccc")}. Open days: ${config.clinic.days.join(", ")}.`,
    };
  }
  const all = slotsForDate(date);
  const booked = bookedSet(date);
  const available = all
    .filter((s) => !booked.has(toUtcIso(s)))
    .filter((s) => filterByPart(s, args.part_of_day))
    .map((s) => ({ start_iso: toUtcIso(s), label: humanLocal(s) }));

  return {
    date,
    open: true,
    slots: available,
    message: available.length === 0 ? "No slots available for that day/part." : undefined,
  };
}

export function checkSlotAvailable(args: { start_iso: string }): {
  available: boolean;
  reason?: string;
  alternatives?: { start_iso: string; label: string }[];
} {
  const dt = parseIsoToClinic(args.start_iso);
  if (!dt.isValid) return { available: false, reason: "Invalid datetime." };
  if (dt <= nowInClinicTz()) return { available: false, reason: "That time is in the past." };
  if (!isWithinClinicHours(dt)) {
    const ymd = dt.toFormat("yyyy-LL-dd");
    const allSlots = slotsForDate(ymd);
    const booked = bookedSet(ymd);
    const free = allSlots
      .filter((s) => !booked.has(toUtcIso(s)))
      .map((s) => ({ start_iso: toUtcIso(s), label: humanLocal(s) }));

    return {
      available: false,
      reason: `Outside clinic hours (${config.clinic.open}–${config.clinic.close}, ${config.clinic.days.join(", ")}).`,
      alternatives: free,
    };
  }
  if (!isOnSlotGrid(dt)) {
    return {
      available: false,
      reason: `Times must align to ${config.clinic.slotMinutes}-minute slots from ${config.clinic.open}.`,
    };
  }
  const startUtc = toUtcIso(dt);
  const clash = db
    .prepare(`SELECT 1 FROM appointments WHERE status='booked' AND start_utc = ?`)
    .get(startUtc);
  if (!clash) return { available: true };

  // suggest nearest alternatives same day
  const ymd = dt.toFormat("yyyy-LL-dd");
  const all = slotsForDate(ymd);
  const booked = bookedSet(ymd);
  const free = all
    .filter((s) => !booked.has(toUtcIso(s)))
    .map((s) => ({ slot: s, diff: Math.abs(s.toMillis() - dt.toMillis()) }))
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 3)
    .map((x) => ({ start_iso: toUtcIso(x.slot), label: humanLocal(x.slot) }));

  return {
    available: false,
    reason: "That slot is already booked.",
    alternatives: free,
  };
}

export { endOfSlot, toUtcIso, humanLocal };
