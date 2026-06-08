"use client";

import { DAYS, type Day } from "@/lib/types";
import { cn } from "@/lib/cn";

export function DaysPicker({
  value,
  onChange,
}: {
  value: Day[];
  onChange: (days: Day[]) => void;
}) {
  const toggle = (d: Day) => {
    onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d]);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {DAYS.map((d) => {
        const active = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => toggle(d)}
            className={cn(
              "h-9 w-12 rounded-lg border text-sm font-medium transition-colors",
              active
                ? "border-brand bg-brand text-brand-foreground"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}
