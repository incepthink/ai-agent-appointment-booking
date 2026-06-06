import { DateTime } from "luxon";
import type { Clinic } from "../clinics";

const SHORT_DAY_TO_LUXON: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

export function nowInClinicTz(clinic: Clinic): DateTime {
  return DateTime.now().setZone(clinic.tz);
}

export function parseIsoToClinic(iso: string, clinic: Clinic): DateTime {
  return DateTime.fromISO(iso, { setZone: true }).setZone(clinic.tz);
}

export function toUtcIso(dt: DateTime): string {
  return dt.toUTC().toISO({ suppressMilliseconds: true })!;
}

export function humanLocal(dt: DateTime, clinic: Clinic): string {
  return dt.setZone(clinic.tz).toFormat("ccc, LLL d 'at' h:mm a");
}

export function isClinicOpenDay(dt: DateTime, clinic: Clinic): boolean {
  const allowed = new Set(clinic.days.map((d) => SHORT_DAY_TO_LUXON[d]));
  return allowed.has(dt.weekday);
}

function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export function isWithinClinicHours(dt: DateTime, clinic: Clinic): boolean {
  const local = dt.setZone(clinic.tz);
  if (!isClinicOpenDay(local, clinic)) return false;
  const mins = local.hour * 60 + local.minute;
  const open = hhmmToMinutes(clinic.open);
  const close = hhmmToMinutes(clinic.close);
  // A slot starting exactly at close is invalid (slot would end after close)
  return mins >= open && mins + clinic.slotMinutes <= close;
}

export function isOnSlotGrid(dt: DateTime, clinic: Clinic): boolean {
  const local = dt.setZone(clinic.tz);
  const minutesFromOpen =
    local.hour * 60 + local.minute - hhmmToMinutes(clinic.open);
  return minutesFromOpen >= 0 && minutesFromOpen % clinic.slotMinutes === 0
    && local.second === 0 && local.millisecond === 0;
}

/**
 * Returns all valid slot starts for a given local date (YYYY-MM-DD).
 * Filters to clinic hours and future (>= now). Does NOT subtract bookings.
 */
export function slotsForDate(dateYmd: string, clinic: Clinic): DateTime[] {
  const [open, close] = [clinic.open, clinic.close].map(hhmmToMinutes);
  const start = DateTime.fromISO(dateYmd, { zone: clinic.tz });
  if (!start.isValid || !isClinicOpenDay(start, clinic)) return [];
  const now = nowInClinicTz(clinic);
  const out: DateTime[] = [];
  for (let m = open; m + clinic.slotMinutes <= close; m += clinic.slotMinutes) {
    const dt = start.set({ hour: Math.floor(m / 60), minute: m % 60, second: 0, millisecond: 0 });
    if (dt <= now) continue;
    out.push(dt);
  }
  return out;
}

export function endOfSlot(start: DateTime, clinic: Clinic): DateTime {
  return start.plus({ minutes: clinic.slotMinutes });
}
