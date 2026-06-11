import type OpenAI from "openai";
import {
  getActiveClinic,
  getClinicByCode,
  listActiveClinics,
  setActiveClinic,
} from "../clinics";
import {
  getActiveDoctor,
  getDoctorByCode,
  listClinicDoctors,
  setActiveDoctor,
} from "../doctors";
import { nowInClinicTz } from "./time";
import { checkSlotAvailable, listAvailableSlots } from "./slots";
import {
  cancelAppointment,
  createAppointment,
  findAppointments,
  rescheduleAppointment,
} from "./appointments";

export const toolSpecs: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_clinics",
      description:
        "Lists the clinics the patient can book at. The available clinics are already in your instructions — only call this as a fallback if that list seems stale or missing.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "select_clinic",
      description:
        "Sets the clinic the patient is booking at (also used to switch clinics). Use the clinic's short code from list_clinics. All subsequent booking actions apply to this clinic.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "The clinic's short code, e.g. SUNRISE." },
        },
        required: ["code"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_doctors",
      description:
        "Lists the doctors at the active clinic with their specialty and working hours. Use this to recommend a doctor for the patient's reason for visit, or to show the other options if the patient declines your suggestion.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "select_doctor",
      description:
        "Sets the doctor the patient will book with (also used to switch doctor). Use the doctor's short code from list_doctors. All subsequent slot and booking actions apply to this doctor. Call this once the patient has agreed to a doctor.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "The doctor's short code, e.g. LOTUS-MEHTA." },
        },
        required: ["code"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_datetime",
      description:
        "Returns the current date and time in the active clinic's timezone. Call this whenever the user uses relative time words like 'today', 'tomorrow', 'this evening', 'next week'.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_available_slots",
      description:
        "Lists available appointment start times for a given date with the SELECTED DOCTOR. A doctor must be selected first (select_doctor). Optionally filter by part of day.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date in YYYY-MM-DD (clinic timezone)." },
          part_of_day: {
            type: "string",
            enum: ["morning", "afternoon", "evening"],
            description: "Optional filter. morning <12:00, afternoon 12:00-15:59, evening >=16:00.",
          },
        },
        required: ["date"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_slot_available",
      description:
        "Checks whether a specific start time is available with the SELECTED DOCTOR. A doctor must be selected first. Returns alternatives if not.",
      parameters: {
        type: "object",
        properties: {
          start_iso: {
            type: "string",
            description: "ISO 8601 datetime, e.g. 2026-05-26T10:00:00+05:30",
          },
        },
        required: ["start_iso"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_appointment",
      description:
        "Creates a booking with the SELECTED DOCTOR at the active clinic. A doctor must be selected first. Only call AFTER the patient has explicitly confirmed the doctor, name, time, and reason. Phone is already known — do not ask for it and do not pass it.",
      parameters: {
        type: "object",
        properties: {
          patient_name: {
            type: "string",
            description:
              'The actual name of the person who will be seen by the doctor — a real name the sender gave you for THIS booking, never one carried over from an earlier appointment in the conversation, never a relationship word like "grandmother" or "my son", and never a placeholder such as "Patient" or "Unknown". If you don\'t have the real name for this booking yet, ask for it before calling this.',
          },
          start_iso: { type: "string", description: "ISO 8601 start datetime." },
          reason: { type: "string" },
        },
        required: ["patient_name", "start_iso"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_appointments",
      description:
        "Returns the patient's upcoming booked appointments across ALL clinics they've booked at. Each result includes clinic_name and clinic_code so you can tell the patient which clinic each appointment is at.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_appointment",
      description:
        "Moves an existing appointment to a new time. Works on any of the patient's appointments by appointment_id (from find_appointments), even one at a clinic that isn't currently selected; the new time is validated against that appointment's own clinic. Confirm with the patient before calling.",
      parameters: {
        type: "object",
        properties: {
          appointment_id: { type: "integer" },
          new_start_iso: { type: "string" },
        },
        required: ["appointment_id", "new_start_iso"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_appointment",
      description:
        "Cancels an appointment by appointment_id (from find_appointments), at whichever clinic it belongs to. Confirm with the patient before calling.",
      parameters: {
        type: "object",
        properties: { appointment_id: { type: "integer" } },
        required: ["appointment_id"],
        additionalProperties: false,
      },
    },
  },
];

const NO_CLINIC = {
  error: "No clinic selected. Use list_clinics to show the options, then select_clinic before booking.",
};

const NO_DOCTOR = {
  error: "No doctor selected. Use list_doctors to see the clinic's doctors, recommend one for the patient's reason, then select_doctor before checking slots or booking.",
};

function doctorSummary(d: { code: string; name: string; specialty: string; bio: string | null; open: string; close: string; days: string[] }) {
  return {
    code: d.code,
    name: d.name,
    specialty: d.specialty,
    bio: d.bio,
    hours: `${d.open}-${d.close}`,
    days: d.days.join(", "),
  };
}

export function dispatchTool(
  name: string,
  rawArgs: string,
  phone: string,
): unknown {
  let args: any = {};
  if (rawArgs) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      return { error: `Invalid JSON arguments for ${name}.` };
    }
  }

  // Clinic-selection tools don't require an active clinic.
  if (name === "list_clinics") {
    return {
      clinics: listActiveClinics().map((c) => ({
        code: c.code,
        name: c.name,
        tz: c.tz,
        hours: `${c.open}-${c.close}`,
        days: c.days.join(", "),
      })),
    };
  }
  if (name === "select_clinic") {
    const clinic = getClinicByCode(String(args.code ?? ""));
    if (!clinic) {
      return { ok: false, error: `Unknown clinic code "${args.code}". Call list_clinics for valid codes.` };
    }
    setActiveClinic(phone, clinic.id);
    return {
      ok: true,
      clinic: {
        code: clinic.code,
        name: clinic.name,
        tz: clinic.tz,
        hours: `${clinic.open}-${clinic.close}`,
        days: clinic.days.join(", "),
      },
    };
  }

  // Everything else operates on the currently-active clinic. Resolve it per call
  // so a select_clinic earlier in the same turn takes effect immediately.
  const clinic = getActiveClinic(phone);
  if (!clinic) return NO_CLINIC;
  const ctx = { phone, clinic };

  // Doctor-roster + selection tools need a clinic but not an active doctor.
  if (name === "list_doctors") {
    return { doctors: listClinicDoctors(clinic.id).map(doctorSummary) };
  }
  if (name === "select_doctor") {
    const doctor = getDoctorByCode(String(args.code ?? ""));
    if (!doctor || doctor.clinicId !== clinic.id) {
      return {
        ok: false,
        error: `Unknown doctor code "${args.code}" at ${clinic.name}. Call list_doctors for valid codes.`,
      };
    }
    setActiveDoctor(phone, doctor.id);
    return { ok: true, doctor: doctorSummary(doctor) };
  }

  switch (name) {
    case "get_current_datetime": {
      const now = nowInClinicTz(clinic);
      return {
        clinic: clinic.name,
        now_iso: now.toISO(),
        tz: clinic.tz,
        today: now.toFormat("yyyy-LL-dd"),
        weekday: now.toFormat("cccc"),
        human: now.toFormat("ccc, LLL d 'at' h:mm a"),
        clinic_hours: `${clinic.open}-${clinic.close}`,
        clinic_days: clinic.days.join(", "),
        slot_minutes: clinic.slotMinutes,
      };
    }
    case "list_available_slots": {
      const doctor = getActiveDoctor(phone);
      if (!doctor) return NO_DOCTOR;
      return listAvailableSlots(doctor, args);
    }
    case "check_slot_available": {
      const doctor = getActiveDoctor(phone);
      if (!doctor) return NO_DOCTOR;
      return checkSlotAvailable(doctor, args);
    }
    case "create_appointment": {
      const doctor = getActiveDoctor(phone);
      if (!doctor) return NO_DOCTOR;
      return createAppointment(ctx, doctor, args);
    }
    case "find_appointments":
      return findAppointments(ctx);
    case "reschedule_appointment":
      return rescheduleAppointment(ctx, args);
    case "cancel_appointment":
      return cancelAppointment(ctx, args);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
