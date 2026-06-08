"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus, Calendar, Phone, Clock, MoreHorizontal, CalendarX2, ArrowLeft } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Appointment } from "@/lib/types";
import { Button, Card, Badge, Spinner } from "@/components/ui";
import { Modal } from "@/components/modal";
import { BookingModal } from "@/components/booking-modal";
import { AppointmentCalendar } from "@/components/appointment-calendar";
import { useClinic } from "@/components/clinic-context";
import { useToast } from "@/components/toast";
import {
  dayKey,
  formatDayKey,
  keyToMonth,
  monthRangeIso,
  todayKey,
} from "@/lib/dates";

export default function AppointmentsPage() {
  const { toast } = useToast();
  const { clinic } = useClinic();
  const tz = clinic.tz;

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  // Visible month + the day whose appointments are shown below the calendar.
  const initial = useMemo(() => keyToMonth(todayKey(tz)), [tz]);
  const [view, setView] = useState<{ year: number; month: number }>(initial);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => todayKey(tz));

  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingDate, setBookingDate] = useState<string | undefined>(undefined);
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);

  // Fetch every appointment in the visible month (plus a little padding so the
  // calendar's spill days are populated). All statuses — cancelled ones render
  // muted, so there's no separate "cancelled" filter to maintain.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { appointments } = await api.listAppointments(monthRangeIso(view.year, view.month));
      setAppointments(appointments);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Failed to load appointments", "error");
    } finally {
      setLoading(false);
    }
  }, [view.year, view.month, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates: refetch whenever the backend reports an appointment change
  // (e.g. a slot booked from the WhatsApp chat), so it appears without a reload.
  useEffect(() => {
    const url = api.appointmentsStreamUrl();
    if (!url) return;
    const es = new EventSource(url);
    es.addEventListener("appointments", () => load());
    // On error EventSource auto-reconnects; nothing to do here.
    return () => es.close();
  }, [load]);

  function changeMonth(delta: number) {
    setView((v) => {
      const m = v.month + delta;
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }

  function goToday() {
    const t = todayKey(tz);
    setView(keyToMonth(t));
    setSelectedKey(t);
  }

  // Selecting a cell focuses that day; a spill day also jumps to its month.
  function selectDay(key: string) {
    const { year, month } = keyToMonth(key);
    if (year !== view.year || month !== view.month) setView({ year, month });
    setSelectedKey(key);
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.cancel(cancelTarget.id);
      toast("Appointment cancelled", "success");
      setCancelTarget(null);
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Cancel failed", "error");
    } finally {
      setCancelling(false);
    }
  }

  function timeOf(label: string) {
    return label.split(" at ")[1] ?? label;
  }

  function openBooking(date?: string) {
    setBookingDate(date);
    setBookingOpen(true);
  }

  // Appointments for the selected day, sorted chronologically.
  const dayAppointments = useMemo(() => {
    if (!selectedKey) return [];
    return appointments
      .filter((a) => dayKey(a.start_iso, tz) === selectedKey)
      .sort((a, b) => a.start_iso.localeCompare(b.start_iso));
  }, [appointments, selectedKey, tz]);

  // Whole-month appointments grouped by day (used when no day is selected).
  const monthGroups = useMemo(() => {
    const inMonth = appointments
      .filter((a) => {
        const { year, month } = keyToMonth(dayKey(a.start_iso, tz));
        return year === view.year && month === view.month;
      })
      .sort((a, b) => a.start_iso.localeCompare(b.start_iso));
    const map = new Map<string, Appointment[]>();
    for (const a of inMonth) {
      const day = a.label.split(" at ")[0];
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(a);
    }
    return Array.from(map.entries());
  }, [appointments, tz, view.year, view.month]);

  const canBookSelected = selectedKey ? selectedKey >= todayKey(tz) : false;

  // A single appointment row, reused by both the day panel and the month list.
  function Row({ a }: { a: Appointment }) {
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
              <Phone className="size-3" /> {a.phone}
            </span>
            {a.reason && <span className="truncate">· {a.reason}</span>}
          </div>
        </div>
        {a.status === "cancelled" ? (
          <Badge tone="muted">Cancelled</Badge>
        ) : (
          <div className="relative">
            <button
              onClick={() => setMenuFor(menuFor === a.id ? null : a.id)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Actions"
            >
              <MoreHorizontal className="size-5" />
            </button>
            {menuFor === a.id && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                <div className="animate-fade-in absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <button
                    onClick={() => {
                      setRescheduleTarget(a);
                      setMenuFor(null);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Reschedule
                  </button>
                  <button
                    onClick={() => {
                      setCancelTarget(a);
                      setMenuFor(null);
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

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Appointments</h1>
          <p className="mt-0.5 text-sm text-slate-500">Bookings made by you and the WhatsApp agent</p>
        </div>
        <Button onClick={() => openBooking(canBookSelected && selectedKey ? selectedKey : undefined)}>
          <Plus className="size-4" />
          New appointment
        </Button>
      </div>

      {/* Two-column on desktop (mini calendar left, list right); stacked on mobile */}
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start lg:gap-8">
        {/* Mini calendar — sticky on desktop, centered & capped on mobile */}
        <div className="mx-auto w-full max-w-xs lg:mx-0 lg:max-w-none lg:sticky lg:top-8">
          <AppointmentCalendar
            appointments={appointments}
            tz={tz}
            openDays={clinic.days}
            year={view.year}
            month={view.month}
            selectedKey={selectedKey}
            onSelectDay={selectDay}
            onPrev={() => changeMonth(-1)}
            onNext={() => changeMonth(1)}
            onToday={goToday}
          />
        </div>

        {/* Appointments: selected day, or the whole month */}
        <div className="min-w-0">
        {selectedKey ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <Calendar className="size-4 text-slate-400" />
                {formatDayKey(selectedKey)}
                <span className="text-slate-400">
                  · {dayAppointments.length} {dayAppointments.length === 1 ? "appointment" : "appointments"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedKey(null)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  <ArrowLeft className="size-3.5" /> Whole month
                </button>
              </div>
            </div>

            {loading ? (
              <LoadingRow />
            ) : dayAppointments.length === 0 ? (
              <EmptyState
                message="No appointments this day"
                hint={canBookSelected ? "The day is free — add one below." : "Nothing was booked on this day."}
                action={
                  canBookSelected ? (
                    <Button variant="secondary" size="sm" onClick={() => openBooking(selectedKey)}>
                      <Plus className="size-4" /> Add appointment
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <Card className="divide-y divide-slate-100">
                {dayAppointments.map((a) => (
                  <Row key={a.id} a={a} />
                ))}
              </Card>
            )}
          </>
        ) : loading ? (
          <LoadingRow />
        ) : monthGroups.length === 0 ? (
          <EmptyState
            message="No appointments this month"
            hint="Pick a day above or add one manually."
            action={
              <Button variant="secondary" size="sm" onClick={() => openBooking()}>
                <Plus className="size-4" /> Add one manually
              </Button>
            }
          />
        ) : (
          <div className="space-y-6">
            {monthGroups.map(([day, items]) => (
              <div key={day}>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-500">
                  <Calendar className="size-4" />
                  {day}
                </div>
                <Card className="divide-y divide-slate-100">
                  {items.map((a) => (
                    <Row key={a.id} a={a} />
                  ))}
                </Card>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* New booking */}
      <BookingModal
        open={bookingOpen}
        initialDate={bookingDate}
        onClose={() => setBookingOpen(false)}
        onDone={() => load()}
      />

      {/* Reschedule */}
      <BookingModal
        open={Boolean(rescheduleTarget)}
        reschedule={rescheduleTarget}
        onClose={() => setRescheduleTarget(null)}
        onDone={() => load()}
      />

      {/* Cancel confirm */}
      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title="Cancel appointment?"
        description={cancelTarget ? `${cancelTarget.patient_name} · ${cancelTarget.label}` : undefined}
      >
        <p className="text-sm text-slate-600">
          This frees up the slot. The patient is not notified automatically.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCancelTarget(null)}>
            Keep it
          </Button>
          <Button variant="danger" loading={cancelling} onClick={confirmCancel}>
            Cancel appointment
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-2 py-16 text-sm text-slate-400">
      <Spinner className="size-5 text-brand" /> Loading…
    </div>
  );
}

function EmptyState({
  message,
  hint,
  action,
}: {
  message: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <CalendarX2 className="size-6" />
      </div>
      <div>
        <p className="font-medium text-slate-700">{message}</p>
        <p className="text-sm text-slate-400">{hint}</p>
      </div>
      {action}
    </Card>
  );
}
