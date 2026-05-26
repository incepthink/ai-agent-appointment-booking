import type OpenAI from "openai";
import { config } from "../config";
import { nowInClinicTz } from "./time";
import { checkSlotAvailable, listAvailableSlots } from "./slots";
import {
  cancelAppointment,
  createAppointment,
  findAppointments,
  rescheduleAppointment,
  type ToolContext,
} from "./appointments";

export const toolSpecs: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_current_datetime",
      description:
        "Returns the current date and time in the clinic's timezone. Call this whenever the user uses relative time words like 'today', 'tomorrow', 'this evening', 'next week'.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_available_slots",
      description:
        "Lists available 30-minute appointment start times for a given date. Optionally filter by part of day.",
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
        "Checks whether a specific start time is available. Returns alternatives if not.",
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
        "Creates a booking. Only call AFTER the patient has explicitly confirmed name, time, and reason. Phone is already known — do not ask for it and do not pass it.",
      parameters: {
        type: "object",
        properties: {
          patient_name: { type: "string" },
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
      description: "Returns upcoming booked appointments for the current patient (by their phone).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_appointment",
      description:
        "Moves an existing appointment to a new time. Confirm with the patient before calling.",
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
      description: "Cancels an appointment. Confirm with the patient before calling.",
      parameters: {
        type: "object",
        properties: { appointment_id: { type: "integer" } },
        required: ["appointment_id"],
        additionalProperties: false,
      },
    },
  },
];

export function dispatchTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): unknown {
  let args: any = {};
  if (rawArgs) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      return { error: `Invalid JSON arguments for ${name}.` };
    }
  }

  switch (name) {
    case "get_current_datetime": {
      const now = nowInClinicTz();
      return {
        now_iso: now.toISO(),
        tz: config.clinic.tz,
        today: now.toFormat("yyyy-LL-dd"),
        weekday: now.toFormat("cccc"),
        human: now.toFormat("ccc, LLL d 'at' h:mm a"),
        clinic_hours: `${config.clinic.open}-${config.clinic.close}`,
        clinic_days: config.clinic.days.join(", "),
        slot_minutes: config.clinic.slotMinutes,
      };
    }
    case "list_available_slots":
      return listAvailableSlots(args);
    case "check_slot_available":
      return checkSlotAvailable(args);
    case "create_appointment":
      return createAppointment(ctx, args);
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
