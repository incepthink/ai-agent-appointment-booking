// Pure, dependency-free date helpers for the appointment calendar.
//
// The clinic's appointments are stored as UTC ISO strings but must be displayed
// (and bucketed onto a calendar grid) in the *clinic's* timezone. Browser-local
// math would put late-evening bookings on the wrong day for far-away zones, so
// every clinic-local day computation goes through Intl with the clinic tz.

// Day-of-week labels for a Monday-start week (matches DAYS in types.ts).
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`;
}

// "Mon, Jun 9" for a plain "YYYY-MM-DD" key (timezone-neutral — it's a date,
// not an instant, so we format via UTC to avoid any local-offset drift).
export function formatDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// { year, month(0-indexed) } for a "YYYY-MM-DD" key.
export function keyToMonth(key: string): { year: number; month: number } {
  const [y, m] = key.split("-").map(Number);
  return { year: y, month: m - 1 };
}

// "YYYY-MM-DD" for the given UTC instant, evaluated in the clinic's timezone.
// en-CA formats as ISO-style (2026-06-09), which we rely on here.
export function dayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

// Today's "YYYY-MM-DD" in the clinic's timezone.
export function todayKey(tz: string): string {
  return dayKey(new Date().toISOString(), tz);
}

// Build a key for a plain calendar date (no timezone involved — the grid cells
// are just calendar dates). Uses UTC to avoid any local-offset drift.
function cellKey(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month, day));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export type Cell = {
  key: string; // YYYY-MM-DD
  day: number; // 1..31
  inMonth: boolean; // false for spill days from prev/next month
  weekday: number; // 0=Mon .. 6=Sun
};

// A Monday-start grid of full weeks covering `month`, including spill days from
// the adjacent months so every row has 7 cells. Pure calendar math (UTC), so it
// never shifts under DST or the viewer's local timezone.
export function monthMatrix(year: number, month: number): Cell[] {
  const first = new Date(Date.UTC(year, month, 1));
  // getUTCDay: 0=Sun..6=Sat → convert to 0=Mon..6=Sun.
  const lead = (first.getUTCDay() + 6) % 7;

  const cells: Cell[] = [];
  const start = new Date(Date.UTC(year, month, 1 - lead));
  // 6 weeks (42 cells) is the max any month spans; trailing empty weeks are
  // trimmed below so short months don't render a blank row.
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    cells.push({
      key: cellKey(y, m, day),
      day,
      inMonth: m === month && y === year,
      weekday: (d.getUTCDay() + 6) % 7,
    });
  }

  // Trim a trailing week that contains no in-month days (keeps the grid tight).
  while (cells.length > 35 && !cells.slice(-7).some((c) => c.inMonth)) {
    cells.length -= 7;
  }
  return cells;
}

// UTC ISO bounds covering the visible month plus padding, for the range fetch.
// The ±7-day pad safely covers grid spill days and timezone edges.
export function monthRangeIso(year: number, month: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month, 1 - 7));
  const to = new Date(Date.UTC(year, month + 1, 7));
  return { from: from.toISOString(), to: to.toISOString() };
}
