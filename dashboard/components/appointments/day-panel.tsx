"use client";

import { ArrowLeft, Calendar, Plus } from "lucide-react";
import type { Appointment } from "@/lib/types";
import { Button, Card } from "@/components/ui";
import { formatDayKey } from "@/lib/dates";
import { AppointmentRow } from "./appointment-row";
import { EmptyState, LoadingRow } from "./appointment-states";

// The selected-day view: header with the date + count, a "Whole month" back
// link, and the day's appointments (or a loading/empty state).
export function DayPanel({
  selectedKey,
  appointments,
  loading,
  canBook,
  onBack,
  onBook,
  onReschedule,
  onCancel,
}: {
  selectedKey: string;
  appointments: Appointment[];
  loading: boolean;
  canBook: boolean;
  onBack: () => void;
  onBook: (date: string) => void;
  onReschedule: (a: Appointment) => void;
  onCancel: (a: Appointment) => void;
}) {
  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
          <Calendar className="size-4 text-slate-400" />
          {formatDayKey(selectedKey)}
          <span className="text-slate-400">
            · {appointments.length} {appointments.length === 1 ? "appointment" : "appointments"}
          </span>
        </div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="size-3.5" /> Whole month
        </button>
      </div>

      {loading ? (
        <LoadingRow />
      ) : appointments.length === 0 ? (
        <EmptyState
          message="No appointments this day"
          hint={canBook ? "The day is free — add one below." : "Nothing was booked on this day."}
          action={
            canBook ? (
              <Button variant="secondary" size="sm" onClick={() => onBook(selectedKey)}>
                <Plus className="size-4" /> Add appointment
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="divide-y divide-slate-100">
          {appointments.map((a) => (
            <AppointmentRow key={a.id} appointment={a} onReschedule={onReschedule} onCancel={onCancel} />
          ))}
        </Card>
      )}
    </>
  );
}
