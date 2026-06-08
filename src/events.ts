// In-process pub/sub for live dashboard updates.
//
// Booking changes (from the WhatsApp agent or the dashboard itself) emit an
// event scoped to a clinic id; the SSE endpoint in api.ts subscribes per clinic
// and pushes a notification to that clinic's connected dashboards. Single-process
// only — fine for the current single-instance deployment.
import { EventEmitter } from "node:events";

const bus = new EventEmitter();
// Many dashboards/tabs per clinic may listen at once.
bus.setMaxListeners(0);

const channel = (clinicId: number) => `appointments:${clinicId}`;

// Notify that a clinic's appointments changed (created / rescheduled / cancelled).
export function emitAppointmentsChanged(clinicId: number): void {
  bus.emit(channel(clinicId));
}

// Subscribe to a clinic's appointment changes. Returns an unsubscribe fn.
export function subscribeAppointments(clinicId: number, listener: () => void): () => void {
  const ch = channel(clinicId);
  bus.on(ch, listener);
  return () => bus.off(ch, listener);
}
