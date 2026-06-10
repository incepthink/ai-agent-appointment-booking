"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Appointment } from "@/lib/types";
import { Button } from "@/components/ui";
import { Modal } from "@/components/modal";
import { BookingModal } from "@/components/booking-modal";
import { AppointmentCalendar } from "@/components/appointment-calendar";
import { useClinic } from "@/components/clinic-context";
import { useToast } from "@/components/toast";
import { dayKey, keyToMonth, todayKey } from "@/lib/dates";
import { DoctorFilter, type DoctorScope } from "@/components/appointments/doctor-filter";
import { DayPanel } from "@/components/appointments/day-panel";
import { MonthList } from "@/components/appointments/month-list";
import { useAppointments } from "@/components/appointments/use-appointments";

export default function AppointmentsPage() {
  const { toast } = useToast();
  const { clinic, doctor } = useClinic();
  const tz = clinic.tz;

  const {
    appointments,
    loading,
    view,
    selectedKey,
    setSelectedKey,
    reload,
    changeMonth,
    goToday,
    selectDay,
  } = useAppointments(tz);

  // "all" → every doctor; "mine" → just the logged-in account's doctor.
  const [scope, setScope] = useState<DoctorScope>("all");

  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingDate, setBookingDate] = useState<string | undefined>(undefined);
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [cancelling, setCancelling] = useState(false);

  function openBooking(date?: string) {
    setBookingDate(date);
    setBookingOpen(true);
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.cancel(cancelTarget.id);
      toast("Appointment cancelled", "success");
      setCancelTarget(null);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Cancel failed", "error");
    } finally {
      setCancelling(false);
    }
  }

  // Apply the scope filter (client-side over the loaded month).
  const visible = useMemo(
    () => (scope === "all" ? appointments : appointments.filter((a) => a.doctor_id === doctor.id)),
    [appointments, scope, doctor.id],
  );

  // Appointments for the selected day, sorted chronologically.
  const dayAppointments = useMemo(() => {
    if (!selectedKey) return [];
    return visible
      .filter((a) => dayKey(a.start_iso, tz) === selectedKey)
      .sort((a, b) => a.start_iso.localeCompare(b.start_iso));
  }, [visible, selectedKey, tz]);

  // Whole-month appointments grouped by day (used when no day is selected).
  const monthGroups = useMemo<[string, Appointment[]][]>(() => {
    const inMonth = visible
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
  }, [visible, tz, view.year, view.month]);

  const canBookSelected = selectedKey ? selectedKey >= todayKey(tz) : false;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Appointments</h1>
          <p className="mt-0.5 text-sm text-slate-500">All bookings at {clinic.name}, across every doctor</p>
        </div>
        <div className="flex items-center gap-3">
          <DoctorFilter value={scope} onChange={setScope} doctorName={doctor.name} />
          <Button onClick={() => openBooking(canBookSelected && selectedKey ? selectedKey : undefined)}>
            <Plus className="size-4" />
            New appointment
          </Button>
        </div>
      </div>

      {/* Two-column on desktop (mini calendar left, list right); stacked on mobile */}
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start lg:gap-8">
        {/* Mini calendar — sticky on desktop, centered & capped on mobile */}
        <div className="mx-auto w-full max-w-xs lg:mx-0 lg:max-w-none lg:sticky lg:top-8">
          <AppointmentCalendar
            appointments={visible}
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
            <DayPanel
              selectedKey={selectedKey}
              appointments={dayAppointments}
              loading={loading}
              canBook={canBookSelected}
              onBack={() => setSelectedKey(null)}
              onBook={openBooking}
              onReschedule={setRescheduleTarget}
              onCancel={setCancelTarget}
            />
          ) : (
            <MonthList
              groups={monthGroups}
              loading={loading}
              onBook={() => openBooking()}
              onReschedule={setRescheduleTarget}
              onCancel={setCancelTarget}
            />
          )}
        </div>
      </div>

      {/* New booking */}
      <BookingModal
        open={bookingOpen}
        initialDate={bookingDate}
        onClose={() => setBookingOpen(false)}
        onDone={() => reload()}
      />

      {/* Reschedule */}
      <BookingModal
        open={Boolean(rescheduleTarget)}
        reschedule={rescheduleTarget}
        onClose={() => setRescheduleTarget(null)}
        onDone={() => reload()}
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
