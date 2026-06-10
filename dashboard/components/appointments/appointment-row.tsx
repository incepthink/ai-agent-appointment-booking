"use client";

import { useState } from "react";
import { Clock, MoreHorizontal, Phone, Stethoscope } from "lucide-react";
import type { Appointment } from "@/lib/types";
import { Badge } from "@/components/ui";
import { formatPhone } from "@/lib/phone";

// Pull the time portion out of a "Mon, Jun 9 at 3:00 PM" style label.
function timeOf(label: string): string {
  return label.split(" at ")[1] ?? label;
}

// A single appointment row, reused by both the day panel and the month list.
// Cancelled rows render muted; active rows expose a Reschedule/Cancel menu that
// manages its own open state.
export function AppointmentRow({
  appointment: a,
  onReschedule,
  onCancel,
}: {
  appointment: Appointment;
  onReschedule: (a: Appointment) => void;
  onCancel: (a: Appointment) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="flex w-20 shrink-0 items-center gap-1.5 text-sm font-semibold text-slate-900">
        <Clock className="size-3.5 text-slate-400" />
        {timeOf(a.label)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900">{a.patient_name}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1">
            <Phone className="size-3" /> {formatPhone(a.phone)}
          </span>
          {a.doctor_name && (
            <span className="inline-flex items-center gap-1 font-medium text-slate-500">
              <Stethoscope className="size-3" /> {a.doctor_name}
            </span>
          )}
          {a.reason && <span className="truncate">· {a.reason}</span>}
        </div>
      </div>
      {a.status === "cancelled" ? (
        <Badge tone="muted">Cancelled</Badge>
      ) : (
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Actions"
          >
            <MoreHorizontal className="size-5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="animate-fade-in absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                <button
                  onClick={() => {
                    onReschedule(a);
                    setMenuOpen(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  Reschedule
                </button>
                <button
                  onClick={() => {
                    onCancel(a);
                    setMenuOpen(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
