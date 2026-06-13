"use client";

import type { ReactNode } from "react";
import { CalendarClock, CalendarRange } from "lucide-react";
import { cn } from "@/lib/cn";

export type ViewMode = "day" | "month";

// Segmented "Today / Month" pill control sitting beside the doctor filter.
// "Today" focuses a single day (defaulting to today); "Month" shows every
// booking in the visible month. Mirrors DoctorFilter so the two read as a pair.
export function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
}) {
  const pill = (mode: ViewMode, label: string, title: string, icon: ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={value === mode}
      title={title}
      onClick={() => onChange(mode)}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors sm:px-4",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        value === mode
          ? "bg-white text-slate-900 shadow-sm"
          : "text-slate-500 hover:text-slate-700",
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      role="tablist"
      aria-label="Show a single day or the whole month"
      className="inline-flex items-center gap-1 rounded-lg bg-slate-200 p-1"
    >
      {pill("day", "Today", "A single day", <CalendarClock className="size-4" />)}
      {pill("month", "Month", "The whole month", <CalendarRange className="size-4" />)}
    </div>
  );
}
