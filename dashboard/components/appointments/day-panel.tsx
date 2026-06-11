"use client";

import { Calendar, Plus } from "lucide-react";
import type { Appointment } from "@/lib/types";
import { Button, Card } from "@/components/ui";
import { formatDayKey } from "@/lib/dates";
import { AppointmentRow } from "./appointment-row";
import { EmptyState, LoadingRow } from "./appointment-states";

// The selected-day view: header with the date + count, and the day's
// appointments (or a loading/empty state). The Today/Month toggle in the page
// header switches back to the whole-month list.
export function DayPanel({
  selectedKey,
  appointments,
  loading,
  canBook,
  onBook,
  onReschedule,
  onCancel,
}: {
  selectedKey: string;
  appointments: Appointment[];
  loading: boolean;
  canBook: boolean;
  onBook: (date: string) => void;
  onReschedule: (a: Appointment) => void;
  onCancel: (a: Appointment) => void;
}) {
  return (
    <>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-600">
        <Calendar className="size-4 text-slate-400" />
        {formatDayKey(selectedKey)}
        <span className="text-slate-400">
          · {appointments.length} {appointments.length === 1 ? "appointment" : "appointments"}
        </span>
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
