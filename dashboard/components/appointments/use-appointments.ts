"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Appointment } from "@/lib/types";
import { keyToMonth, monthRangeIso, todayKey } from "@/lib/dates";
import { useToast } from "@/components/toast";

// Owns everything data-and-calendar related for the appointments page: the
// loaded month of appointments, loading state, the visible month, the selected
// day, and live (SSE) refreshes. The page stays declarative and just consumes
// what this returns.
export function useAppointments(tz: string) {
  const { toast } = useToast();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  // Ids seen on the last fetch — lets a silent (SSE) reload spot genuinely new
  // bookings (ids that weren't here before) and announce them with a toast.
  const knownIds = useRef<Set<number>>(new Set());

  // Visible month + the day whose appointments are shown below the calendar.
  const initial = useMemo(() => keyToMonth(todayKey(tz)), [tz]);
  const [view, setView] = useState<{ year: number; month: number }>(initial);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => todayKey(tz));

  // Fetch every appointment in the visible month (plus padding so the calendar's
  // spill days are populated). All statuses — cancelled ones render muted.
  // `silent` skips the loading state — used by live (SSE) refreshes so a newly
  // booked appointment slots into the list in place without flashing the
  // loading skeleton. Initial load and month changes pass nothing (loading on).
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { appointments } = await api.listAppointments(monthRangeIso(view.year, view.month));
      // On a live refresh, announce any genuinely new bookings. A reschedule or
      // cancel keeps the same id, so only brand-new appointments show up here.
      if (silent) {
        const added = appointments.filter(
          (a) => a.status === "booked" && !knownIds.current.has(a.id),
        );
        if (added.length === 1) {
          toast(`New appointment: ${added[0].patient_name} · ${added[0].label}`, "success");
        } else if (added.length > 1) {
          toast(`${added.length} new appointments booked`, "success");
        }
      }
      knownIds.current = new Set(appointments.map((a) => a.id));
      setAppointments(appointments);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Failed to load appointments", "error");
    } finally {
      if (!silent) setLoading(false);
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
    es.addEventListener("appointments", () => load(true));
    // On error EventSource auto-reconnects; nothing to do here.
    return () => es.close();
  }, [load]);

  const changeMonth = useCallback((delta: number) => {
    setView((v) => {
      const m = v.month + delta;
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }, []);

  const goToday = useCallback(() => {
    const t = todayKey(tz);
    setView(keyToMonth(t));
    setSelectedKey(t);
  }, [tz]);

  // Selecting a cell focuses that day; a spill day also jumps to its month.
  const selectDay = useCallback(
    (key: string) => {
      const { year, month } = keyToMonth(key);
      setView((v) => (year !== v.year || month !== v.month ? { year, month } : v));
      setSelectedKey(key);
    },
    [],
  );

  return {
    appointments,
    loading,
    view,
    selectedKey,
    setSelectedKey,
    reload: load,
    changeMonth,
    goToday,
    selectDay,
  };
}
