import { DateTime } from "luxon";
import { db } from "../db";
import type { Doctor } from "../doctors";
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

function filterByPart(slot: DateTime, doctor: Doctor, part?: PartOfDay): boolean {
  if (!part) return true;
  const h = slot.setZone(doctor.tz).hour;
  if (part === "morning") return h < 12;
  if (part === "afternoon") return h >= 12 && h < 16;
  return h >= 16;
}

// Slots already booked for THIS doctor on a given local date. Availability is
// per-doctor, so the guard is doctor_id (two doctors can share a wall-clock slot).
function bookedSet(doctor: Doctor, dateYmd: string): Set<string> {
  const start = DateTime.fromISO(dateYmd, { zone: doctor.tz }).startOf("day");
  const end = start.plus({ days: 1 });
  const rows = db
    .prepare(
      `SELECT start_utc FROM appointments
       WHERE doctor_id = ? AND status = 'booked' AND start_utc >= ? AND start_utc < ?`,
    )
    .all(doctor.id, toUtcIso(start), toUtcIso(end)) as { start_utc: string }[];
  return new Set(rows.map((r) => r.start_utc));
}

export function listAvailableSlots(
  doctor: Doctor,
  args: { date: string; part_of_day?: PartOfDay },
): {
  date: string;
  open: boolean;
  slots: { start_iso: string; label: string }[];
  count: number;
  first_label?: string;
  last_label?: string;
  message?: string;
} {
  const date = args.date;
  const dt = DateTime.fromISO(date, { zone: doctor.tz });
  if (!dt.isValid) {
    return { date, open: false, slots: [], count: 0, message: "Invalid date format. Use YYYY-MM-DD." };
  }
  if (!isClinicOpenDay(dt, doctor)) {
    return {
      date,
      open: false,
      slots: [],
      count: 0,
      message: `${doctor.name} is not available on ${dt.toFormat("cccc")}. Available days: ${doctor.days.join(", ")}.`,
    };
  }
  const all = slotsForDate(date, doctor);
  const booked = bookedSet(doctor, date);
  const available = all
    .filter((s) => !booked.has(toUtcIso(s)))
    .filter((s) => filterByPart(s, doctor, args.part_of_day))
    .map((s) => ({ start_iso: toUtcIso(s), label: humanLocal(s, doctor) }));

  return {
    date,
    open: true,
    slots: available,
    count: available.length,
    first_label: available[0]?.label,
    last_label: available[available.length - 1]?.label,
    message: available.length === 0 ? "No slots available for that day/part." : undefined,
  };
}

export function checkSlotAvailable(
  doctor: Doctor,
  args: { start_iso: string },
): {
  available: boolean;
  reason?: string;
  alternatives?: { start_iso: string; label: string }[];
} {
  const dt = parseIsoToClinic(args.start_iso, doctor);
  if (!dt.isValid) return { available: false, reason: "Invalid datetime." };
  if (dt <= nowInClinicTz(doctor)) return { available: false, reason: "That time is in the past." };
  if (!isWithinClinicHours(dt, doctor)) {
    const ymd = dt.toFormat("yyyy-LL-dd");
    const allSlots = slotsForDate(ymd, doctor);
    const booked = bookedSet(doctor, ymd);
    const free = allSlots
      .filter((s) => !booked.has(toUtcIso(s)))
      .map((s) => ({ start_iso: toUtcIso(s), label: humanLocal(s, doctor) }));

    return {
      available: false,
      reason: `Outside ${doctor.name}'s hours (${doctor.open}–${doctor.close}, ${doctor.days.join(", ")}).`,
      alternatives: free,
    };
  }
  if (!isOnSlotGrid(dt, doctor)) {
    return {
      available: false,
      reason: `Times must align to ${doctor.slotMinutes}-minute slots from ${doctor.open}.`,
    };
  }
  const startUtc = toUtcIso(dt);
  const clash = db
    .prepare(`SELECT 1 FROM appointments WHERE doctor_id = ? AND status='booked' AND start_utc = ?`)
    .get(doctor.id, startUtc);
  if (!clash) return { available: true };

  // suggest nearest alternatives same day, same doctor
  const ymd = dt.toFormat("yyyy-LL-dd");
  const all = slotsForDate(ymd, doctor);
  const booked = bookedSet(doctor, ymd);
  const free = all
    .filter((s) => !booked.has(toUtcIso(s)))
    .map((s) => ({ slot: s, diff: Math.abs(s.toMillis() - dt.toMillis()) }))
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 3)
    .map((x) => ({ start_iso: toUtcIso(x.slot), label: humanLocal(x.slot, doctor) }));

  return {
    available: false,
    reason: `That slot is already booked with ${doctor.name}.`,
    alternatives: free,
  };
}

export { endOfSlot, toUtcIso, humanLocal };
