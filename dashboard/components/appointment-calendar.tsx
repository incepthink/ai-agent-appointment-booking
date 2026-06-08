"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Appointment, Day } from "@/lib/types";
import { dayKey, monthLabel, monthMatrix, todayKey, WEEKDAYS } from "@/lib/dates";
import { cn } from "@/lib/cn";

// Maps WEEKDAYS index (0=Mon..6=Sun) to the Day code stored in clinic.days.
const WEEKDAY_CODES: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type DayStats = { booked: number; cancelled: number };

export function AppointmentCalendar({
  appointments,
  tz,
  openDays,
  year,
  month,
  selectedKey,
  onSelectDay,
  onPrev,
  onNext,
  onToday,
}: {
  appointments: Appointment[];
  tz: string;
  openDays: Day[];
  year: number;
  month: number;
  selectedKey: string | null;
  onSelectDay: (key: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const cells = useMemo(() => monthMatrix(year, month), [year, month]);
  const today = useMemo(() => todayKey(tz), [tz]);
  const openSet = useMemo(() => new Set(openDays), [openDays]);

  // Bucket booked/cancelled counts per clinic-local day key.
  const stats = useMemo(() => {
    const map = new Map<string, DayStats>();
    for (const a of appointments) {
      const key = dayKey(a.start_iso, tz);
      const s = map.get(key) ?? { booked: 0, cancelled: 0 };
      if (a.status === "cancelled") s.cancelled++;
      else s.booked++;
      map.set(key, s);
    }
    return map;
  }, [appointments, tz]);

  // Month summary counts only in-month, non-cancelled appointments.
  const monthBooked = useMemo(() => {
    const inMonth = new Set(cells.filter((c) => c.inMonth).map((c) => c.key));
    let n = 0;
    for (const [key, s] of stats) if (inMonth.has(key)) n += s.booked;
    return n;
  }, [cells, stats]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-card p-3 shadow-sm">
      {/* Header: month label + nav */}
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold text-slate-900">{monthLabel(year, month)}</h2>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onToday}
            className="mr-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            Today
          </button>
          <button
            onClick={onPrev}
            aria-label="Previous month"
            className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={onNext}
            aria-label="Next month"
            className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Weekday header (single letters, Monday-start) */}
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((d) => (
          <div key={d} className="pb-1 text-center text-[11px] font-medium text-slate-400">
            {d[0]}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 justify-items-center gap-y-0.5">
        {cells.map((c) => {
          const s = stats.get(c.key);
          const isToday = c.key === today;
          const isSelected = c.key === selectedKey;
          const isClosed = !openSet.has(WEEKDAY_CODES[c.weekday]);
          const hasEvents = !!s && (s.booked > 0 || s.cancelled > 0);

          return (
            <button
              key={c.key}
              onClick={() => onSelectDay(c.key)}
              aria-label={`${c.key}${s ? `, ${s.booked} booked` : ""}`}
              aria-pressed={isSelected}
              className={cn(
                "relative flex size-9 items-center justify-center rounded-full text-[13px] tabular-nums transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                !c.inMonth && "text-slate-300",
                c.inMonth && !isSelected && !isToday && "text-slate-700 hover:bg-slate-100",
                c.inMonth && isClosed && !isSelected && !isToday && "text-slate-400",
                isToday && !isSelected && "font-semibold text-brand hover:bg-indigo-50",
                isSelected && "bg-brand font-semibold text-brand-foreground hover:bg-indigo-700",
              )}
            >
              {c.day}

              {/* Minimal event dot */}
              {hasEvents && (
                <span
                  className={cn(
                    "absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full",
                    isSelected
                      ? "bg-white/80"
                      : s!.booked > 0
                        ? "bg-brand"
                        : "bg-slate-300",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Month summary */}
      <p className="mt-2 border-t border-slate-100 px-1 pt-2 text-[11px] text-slate-400">
        <span className="font-semibold text-slate-600">{monthBooked}</span>{" "}
        {monthBooked === 1 ? "appointment" : "appointments"} this month
      </p>
    </div>
  );
}
