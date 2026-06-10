"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Appointment, Slot } from "@/lib/types";
import { Button, Field, Input, Select, Textarea, Spinner } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { useClinic } from "@/components/clinic-context";
import { cn } from "@/lib/cn";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function BookingModal({
  open,
  onClose,
  onDone,
  reschedule,
  initialDate,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (appt: Appointment) => void;
  reschedule?: Appointment | null;
  initialDate?: string;
}) {
  const { toast } = useToast();
  const { doctors } = useClinic();
  const isReschedule = Boolean(reschedule);

  const [patientName, setPatientName] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayYmd());
  // Which doctor this booking is for. On reschedule it's fixed to the
  // appointment's own doctor (validated server-side against that doctor).
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsMsg, setSlotsMsg] = useState<string | undefined>();
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset form each time the modal opens.
  useEffect(() => {
    if (open) {
      setPatientName("");
      setPhone("");
      setReason("");
      setDate(initialDate ?? todayYmd());
      setSelected(null);
      setDoctorId(reschedule?.doctor_id ?? doctors[0]?.id ?? null);
    }
  }, [open, initialDate, reschedule, doctors]);

  // Load slots whenever the date or selected doctor changes (while open).
  useEffect(() => {
    if (!open) return;
    if (doctorId == null) {
      setSlots([]);
      setSlotsMsg("Select a doctor to see available times.");
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    setSelected(null);
    api
      .getSlots(date, doctorId)
      .then((r) => {
        if (cancelled) return;
        setSlots(r.slots);
        setSlotsMsg(r.open ? r.message : r.message ?? "The doctor is not available that day.");
      })
      .catch(() => !cancelled && setSlotsMsg("Could not load slots."))
      .finally(() => !cancelled && setLoadingSlots(false));
    return () => {
      cancelled = true;
    };
  }, [date, open, doctorId]);

  async function submit() {
    if (!selected) {
      toast("Pick a time slot", "error");
      return;
    }
    setSubmitting(true);
    try {
      if (isReschedule && reschedule) {
        const { appointment } = await api.reschedule(reschedule.id, selected);
        toast("Appointment rescheduled", "success");
        onDone(appointment);
      } else {
        if (doctorId == null) {
          toast("Pick a doctor", "error");
          setSubmitting(false);
          return;
        }
        const { appointment } = await api.createAppointment({
          patient_name: patientName,
          phone,
          start_iso: selected,
          reason: reason || undefined,
          doctor_id: doctorId,
        });
        toast("Appointment booked", "success");
        onDone(appointment);
      }
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Something went wrong", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = isReschedule
    ? Boolean(selected)
    : Boolean(patientName.trim() && phone.trim() && selected && doctorId != null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isReschedule ? "Reschedule appointment" : "New appointment"}
      description={
        isReschedule && reschedule
          ? `${reschedule.patient_name} · currently ${reschedule.label}`
          : "Book a slot on behalf of a patient"
      }
    >
      <div className="space-y-4">
        {!isReschedule && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Patient name">
                <Input value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="Jane Doe" />
              </Field>
              <Field label="Phone (WhatsApp)">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 99999 99999" />
              </Field>
            </div>
            <Field label="Reason" hint="Optional">
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Checkup, follow-up…" />
            </Field>
            <Field label="Doctor">
              <Select
                value={doctorId == null ? "" : String(doctorId)}
                onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : null)}
              >
                {doctors.length === 0 && <option value="">No doctors available</option>}
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} — {d.specialty}</option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {isReschedule && reschedule?.doctor_name && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
            Doctor: <span className="font-medium text-slate-700">{reschedule.doctor_name}</span>
          </p>
        )}

        <Field label="Date">
          <Input type="date" value={date} min={todayYmd()} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Available times</p>
          {loadingSlots ? (
            <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
              <Spinner className="size-4" /> Loading slots…
            </div>
          ) : slots.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-400">
              {slotsMsg ?? "No available slots."}
            </p>
          ) : (
            <div className="grid max-h-44 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
              {slots.map((s) => {
                const active = selected === s.start_iso;
                const time = s.label.split(" at ")[1] ?? s.label;
                return (
                  <button
                    key={s.start_iso}
                    type="button"
                    onClick={() => setSelected(s.start_iso)}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                      active
                        ? "border-brand bg-brand text-brand-foreground"
                        : "border-slate-200 bg-white text-slate-600 hover:border-brand/40 hover:bg-slate-50",
                    )}
                  >
                    {time}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting} disabled={!canSubmit}>
            {isReschedule ? "Reschedule" : "Book appointment"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
