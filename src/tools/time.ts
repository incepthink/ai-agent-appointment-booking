import { DateTime } from "luxon";
import { config } from "../config";

const SHORT_DAY_TO_LUXON: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

export function nowInClinicTz(): DateTime {
  return DateTime.now().setZone(config.clinic.tz);
}

export function parseIsoToClinic(iso: string): DateTime {
  return DateTime.fromISO(iso, { setZone: true }).setZone(config.clinic.tz);
}

export function toUtcIso(dt: DateTime): string {
  return dt.toUTC().toISO({ suppressMilliseconds: true })!;
}

export function humanLocal(dt: DateTime): string {
  return dt.setZone(config.clinic.tz).toFormat("ccc, LLL d 'at' h:mm a");
}

export function isClinicOpenDay(dt: DateTime): boolean {
  const allowed = new Set(config.clinic.days.map((d) => SHORT_DAY_TO_LUXON[d]));
  return allowed.has(dt.weekday);
}

function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export function isWithinClinicHours(dt: DateTime): boolean {
  const local = dt.setZone(config.clinic.tz);
  if (!isClinicOpenDay(local)) return false;
  const mins = local.hour * 60 + local.minute;
  const open = hhmmToMinutes(config.clinic.open);
  const close = hhmmToMinutes(config.clinic.close);
  // A slot starting exactly at close is invalid (slot would end after close)
  return mins >= open && mins + config.clinic.slotMinutes <= close;
}

export function isOnSlotGrid(dt: DateTime): boolean {
  const local = dt.setZone(config.clinic.tz);
  const minutesFromOpen =
    local.hour * 60 + local.minute - hhmmToMinutes(config.clinic.open);
  return minutesFromOpen >= 0 && minutesFromOpen % config.clinic.slotMinutes === 0
    && local.second === 0 && local.millisecond === 0;
}

/**
 * Returns all valid 30-min slot starts for a given local date (YYYY-MM-DD).
 * Filters to clinic hours and future (>= now). Does NOT subtract bookings.
 */
export function slotsForDate(dateYmd: string): DateTime[] {
  const [open, close] = [config.clinic.open, config.clinic.close].map(hhmmToMinutes);
  const start = DateTime.fromISO(dateYmd, { zone: config.clinic.tz });
  if (!start.isValid || !isClinicOpenDay(start)) return [];
  const now = nowInClinicTz();
  const out: DateTime[] = [];
  for (let m = open; m + config.clinic.slotMinutes <= close; m += config.clinic.slotMinutes) {
    const dt = start.set({ hour: Math.floor(m / 60), minute: m % 60, second: 0, millisecond: 0 });
    if (dt <= now) continue;
    out.push(dt);
  }
  return out;
}

export function endOfSlot(start: DateTime): DateTime {
  return start.plus({ minutes: config.clinic.slotMinutes });
}
