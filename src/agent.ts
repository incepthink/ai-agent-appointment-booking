import OpenAI from "openai";
import { config } from "./config";
import { dispatchTool, toolSpecs } from "./tools";
import { getActiveClinic, type Clinic } from "./clinics";
import { nowInClinicTz } from "./tools/time";
import {
  appendAssistant,
  appendTool,
  appendUser,
  getLastMessageAt,
  loadHistory,
} from "./session";

const client = new OpenAI({ apiKey: config.openai.apiKey });

const MAX_ITERATIONS = 6;

// How long without any message before we treat the next one as a new conversation
// (re-welcome the patient and let them re-pick their clinic). Easy to tune.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

function systemPrompt(phone: string, clinic: Clinic | null, freshStart: boolean): string {
  const common = [
    `The patient's WhatsApp number is ${phone}. You already know it — never ask for it and never pass it to tools.`,
    `You serve several clinics from one WhatsApp number. The patient can switch clinics anytime by asking — when they do, call select_clinic with the new clinic's code.`,
    ``,
    `Style: keep replies short and natural for WhatsApp. No markdown, no bullet symbols, no long lists. One or two short sentences per turn is ideal.`,
  ];

  if (!clinic) {
    return [
      `You are a friendly receptionist booking appointments across several clinics, over WhatsApp.`,
      `The patient has NOT picked a clinic yet, so you cannot book anything until one is selected.`,
      ``,
      `On the patient's first message (any greeting like "hi", "hey", "hello"), introduce yourself, say you can help book, reschedule, or cancel appointments, then call list_clinics and present the clinics so they can choose one.`,
      `When the patient names or picks a clinic, call select_clinic with its code before doing anything else.`,
      `Do not ask for booking details (name, date, time) until a clinic has been selected.`,
      ``,
      ...common,
    ].join("\n");
  }

  const now = nowInClinicTz(clinic);
  return [
    `You are the receptionist for "${clinic.name}", which has one shared appointment calendar. You chat with patients over WhatsApp.`,
    ``,
    `Current local time: ${now.toFormat("cccc, LLL d yyyy, h:mm a")} (${clinic.tz}).`,
    `Clinic hours: ${clinic.open}-${clinic.close}, ${clinic.days.join(", ")}.`,
    `Appointments are ${clinic.slotMinutes} minutes long.`,
    ``,
    `Never ask which doctor or specialty; there is only one shared calendar at this clinic.`,
    ``,
    `What you need to book: patient name, preferred date, preferred time, and reason for visit. Ask ONLY for what's still missing.`,
    ``,
    `Rules:`,
    freshStart
      ? `- This is the start of a new conversation (the patient hasn't messaged in a while). On their first message (any greeting like "hi", "hey", "hello", etc.), treat it as a fresh start: introduce yourself, say you can help book, reschedule, or cancel appointments, and mention you serve several clinics. Note that they were last booking with ${clinic.name}, then call list_clinics and ask whether they'd like to continue with ${clinic.name} or pick a different one. Do NOT assume ${clinic.name} for a new booking until they confirm or choose.`
      : `- If the patient sends a greeting (like "hi", "hey", "hello"), briefly reintroduce that you are the receptionist for ${clinic.name} and can help book, reschedule, or cancel appointments — and that they can switch clinics anytime by asking. Keep it to one or two short sentences.`,
    `- If the patient wants a different clinic, call list_clinics and/or select_clinic. NEW bookings always apply to the currently selected clinic. Reschedules and cancellations apply to whichever clinic the chosen appointment belongs to (find_appointments returns appointments across all clinics, each with its clinic name).`,
    `- Always name the clinic when confirming a booking, reschedule, or cancellation, and when listing appointments (e.g. "9:00 AM at Harbor Medical"). When listing appointments from find_appointments, include the clinic_name for each one.`,
    `- Whenever a requested time is unavailable for any reason (outside clinic hours, clinic closed that day, or slot already taken), always call list_available_slots for that date and include the clinic's opening hours plus the available slots in your reply so the patient can pick one directly.`,
    `- Use get_current_datetime whenever the user says "today", "tomorrow", "this evening", etc.`,
    `- Never invent or guess available slots. Always verify with list_available_slots or check_slot_available.`,
    `- Never book a time in the past or outside clinic hours.`,
    `- Before calling create_appointment, reschedule_appointment, or cancel_appointment, repeat the full details back and get an explicit yes from the patient.`,
    `- If a requested slot is taken, offer 2-3 nearby alternatives.`,
    `- For reschedule/cancel, first look up the patient's existing booking with find_appointments.`,
    ``,
    ...common,
  ].join("\n");
}

export async function handleIncoming(phone: string, text: string): Promise<string> {
  // Read last-seen time BEFORE appending the just-arrived message so it doesn't count.
  const lastSeen = getLastMessageAt(phone);
  const freshStart = !lastSeen || Date.now() - lastSeen.getTime() > STALE_AFTER_MS;

  appendUser(phone, text);

  const clinic = getActiveClinic(phone);
  console.log(`[agent] phone=${phone} active_clinic=${clinic ? `${clinic.name} [${clinic.code}]` : "none"} fresh_start=${freshStart}`);

  const history = loadHistory(phone);
  console.log(`[agent] history_msgs=${history.length}`);

  const prompt = systemPrompt(phone, clinic, freshStart);
  console.log(`[agent] system_prompt_head=${prompt.slice(0, 120).replace(/\n/g, " | ")}`);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: prompt },
    ...history,
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const completion = await client.chat.completions.create({
      model: config.openai.model,
      messages,
      tools: toolSpecs,
      tool_choice: "auto",
      temperature: 0.3,
    });

    const msg = completion.choices[0]?.message;
    if (!msg) {
      const fallback = "Sorry, I didn't catch that. Could you say it again?";
      appendAssistant(phone, fallback);
      return fallback;
    }

    const toolCalls = msg.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      appendAssistant(phone, msg.content ?? null, toolCalls);
      messages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: toolCalls,
      } as OpenAI.Chat.Completions.ChatCompletionMessageParam);

      for (const call of toolCalls) {
        const result = dispatchTool(
          call.function.name,
          call.function.arguments ?? "{}",
          phone,
        );
        const resultJson = JSON.stringify(result);
        appendTool(phone, call.id, call.function.name, resultJson);
        messages.push({
          role: "tool",
          content: resultJson,
          tool_call_id: call.id,
        });
      }
      continue;
    }

    const reply = (msg.content ?? "").trim() ||
      "Sorry, I didn't quite get that. Could you rephrase?";
    appendAssistant(phone, reply);
    return reply;
  }

  const fallback = "Sorry, I'm having trouble completing that right now. Please try again in a moment.";
  appendAssistant(phone, fallback);
  return fallback;
}
