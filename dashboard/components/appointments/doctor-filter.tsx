"use client";

import type { ReactNode } from "react";
import { User, Users } from "lucide-react";
import { cn } from "@/lib/cn";

export type DoctorScope = "all" | "mine";

// Segmented "All / My" pill control replacing the old per-doctor dropdown.
// "All" shows every doctor's bookings; "My" narrows to the logged-in account's
// own doctor. The active pill is visually obvious, and the doctor's name is
// surfaced via title/aria-label so "My" is never ambiguous.
export function DoctorFilter({
  value,
  onChange,
  doctorName,
}: {
  value: DoctorScope;
  onChange: (value: DoctorScope) => void;
  doctorName: string;
}) {
  const pill = (
    scope: DoctorScope,
    label: string,
    title: string,
    icon: ReactNode,
  ) => (
    <button
      type="button"
      role="tab"
      aria-selected={value === scope}
      title={title}
      onClick={() => onChange(scope)}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors sm:px-4",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        value === scope
          ? "bg-white text-slate-900 shadow-sm"
          : "text-slate-500 hover:text-slate-700",
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="inline-flex items-center gap-2">
      {/* <span className="text-xs font-medium text-slate-500">Showing</span> */}
      <div
        role="tablist"
        aria-label="Filter appointments by doctor"
        className="inline-flex items-center gap-1 rounded-lg bg-slate-200 p-1"
      >
        {pill("all", "All", "All doctors", <Users className="size-4" />)}
        {pill(
          "mine",
          "My",
          `My appointments (${doctorName})`,
          <User className="size-4" />,
        )}
      </div>
    </div>
  );
}
