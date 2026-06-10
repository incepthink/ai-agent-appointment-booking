"use client";

import { Calendar, Plus } from "lucide-react";
import type { Appointment } from "@/lib/types";
import { Button, Card } from "@/components/ui";
import { AppointmentRow } from "./appointment-row";
import { EmptyState, LoadingRow } from "./appointment-states";

// The whole-month view: appointments grouped by day, shown when no single day
// is selected.
export function MonthList({
  groups,
  loading,
  onBook,
  onReschedule,
  onCancel,
}: {
  groups: [string, Appointment[]][];
  loading: boolean;
  onBook: () => void;
  onReschedule: (a: Appointment) => void;
  onCancel: (a: Appointment) => void;
}) {
  if (loading) return <LoadingRow />;

  if (groups.length === 0) {
    return (
      <EmptyState
        message="No appointments this month"
        hint="Pick a day above or add one manually."
        action={
          <Button variant="secondary" size="sm" onClick={onBook}>
            <Plus className="size-4" /> Add one manually
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {groups.map(([day, items]) => (
        <div key={day}>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-500">
            <Calendar className="size-4" />
            {day}
          </div>
          <Card className="divide-y divide-slate-100">
            {items.map((a) => (
              <AppointmentRow key={a.id} appointment={a} onReschedule={onReschedule} onCancel={onCancel} />
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}
