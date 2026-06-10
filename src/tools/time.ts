import { DateTime } from "luxon";
import type { Day } from "../clinics";

// A bookable schedule: timezone + working hours/days + slot length. Both `Clinic`
// and `Doctor` satisfy this structurally, so the same slot/availability engine
// serves either. (Function names keep the "Clinic" suffix for call-site stability;
// they operate on any Schedule.)
export type Schedule = {
  tz: string;
  open: string;
  close: string;
  days: Day[];
  slotMinutes: number;
};

const SHORT_DAY_TO_LUXON: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

export function nowInClinicTz(s: Schedule): DateTime {
  return DateTime.now().setZone(s.tz);
}

export function parseIsoToClinic(iso: string, s: Schedule): DateTime {
  return DateTime.fromISO(iso, { setZone: true }).setZone(s.tz);
}

export function toUtcIso(dt: DateTime): string {
  return dt.toUTC().toISO({ suppressMilliseconds: true })!;
}

export function humanLocal(dt: DateTime, s: Schedule): string {
  return dt.setZone(s.tz).toFormat("ccc, LLL d 'at' h:mm a");
}

export function isClinicOpenDay(dt: DateTime, s: Schedule): boolean {
  const allowed = new Set(s.days.map((d) => SHORT_DAY_TO_LUXON[d]));
  return allowed.has(dt.weekday);
}

function hhmmToMinutes(str: string): number {
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
}

export function isWithinClinicHours(dt: DateTime, s: Schedule): boolean {
  const local = dt.setZone(s.tz);
  if (!isClinicOpenDay(local, s)) return false;
  const mins = local.hour * 60 + local.minute;
  const open = hhmmToMinutes(s.open);
  const close = hhmmToMinutes(s.close);
  // A slot starting exactly at close is invalid (slot would end after close)
  return mins >= open && mins + s.slotMinutes <= close;
}

export function isOnSlotGrid(dt: DateTime, s: Schedule): boolean {
  const local = dt.setZone(s.tz);
  const minutesFromOpen =
    local.hour * 60 + local.minute - hhmmToMinutes(s.open);
  return minutesFromOpen >= 0 && minutesFromOpen % s.slotMinutes === 0
    && local.second === 0 && local.millisecond === 0;
}

/**
 * Returns all valid slot starts for a given local date (YYYY-MM-DD).
 * Filters to the schedule's hours and future (>= now). Does NOT subtract bookings.
 */
export function slotsForDate(dateYmd: string, s: Schedule): DateTime[] {
  const [open, close] = [s.open, s.close].map(hhmmToMinutes);
  const start = DateTime.fromISO(dateYmd, { zone: s.tz });
  if (!start.isValid || !isClinicOpenDay(start, s)) return [];
  const now = nowInClinicTz(s);
  const out: DateTime[] = [];
  for (let m = open; m + s.slotMinutes <= close; m += s.slotMinutes) {
    const dt = start.set({ hour: Math.floor(m / 60), minute: m % 60, second: 0, millisecond: 0 });
    if (dt <= now) continue;
    out.push(dt);
  }
  return out;
}

export function endOfSlot(start: DateTime, s: Schedule): DateTime {
  return start.plus({ minutes: s.slotMinutes });
}
