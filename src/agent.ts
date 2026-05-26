import OpenAI from "openai";
import { config } from "./config";
import { dispatchTool, toolSpecs } from "./tools";
import { nowInClinicTz } from "./tools/time";
import {
  appendAssistant,
  appendTool,
  appendUser,
  loadHistory,
} from "./session";

const client = new OpenAI({ apiKey: config.openai.apiKey });

const MAX_ITERATIONS = 6;

function systemPrompt(phone: string): string {
  const now = nowInClinicTz();
  return [
    `You are the receptionist for "${config.clinic.name}", a single clinic with one shared appointment calendar. You chat with patients over WhatsApp.`,
    ``,
    `Current local time: ${now.toFormat("cccc, LLL d yyyy, h:mm a")} (${config.clinic.tz}).`,
    `Clinic hours: ${config.clinic.open}-${config.clinic.close}, ${config.clinic.days.join(", ")}.`,
    `Appointments are ${config.clinic.slotMinutes} minutes long.`,
    ``,
    `The patient's WhatsApp number is ${phone}. You already know it — never ask for it and never pass it to tools.`,
    `Never ask which doctor or specialty; there is only one shared calendar.`,
    ``,
    `What you need to book: patient name, preferred date, preferred time, and reason for visit. Ask ONLY for what's still missing.`,
    ``,
    `Rules:`,
    `- On the user's very first message (any greeting like "hi", "hey", "hello", "good morning", etc.), immediately introduce yourself and mention that you are the receptionist for ${config.clinic.name}, and state upfront that you can help book, reschedule, or cancel appointments — do not wait for the user to ask what you do.`,
    `- Whenever a requested time is unavailable for any reason (outside clinic hours, clinic closed that day, or slot already taken), always call list_available_slots for that date and include the clinic's opening hours plus the available slots in your reply so the patient can pick one directly.`,
    `- Use get_current_datetime whenever the user says "today", "tomorrow", "this evening", etc.`,
    `- Never invent or guess available slots. Always verify with list_available_slots or check_slot_available.`,
    `- Never book a time in the past or outside clinic hours.`,
    `- Before calling create_appointment, reschedule_appointment, or cancel_appointment, repeat the full details back and get an explicit yes from the patient.`,
    `- If a requested slot is taken, offer 2-3 nearby alternatives.`,
    `- For reschedule/cancel, first look up the patient's existing booking with find_appointments.`,
    ``,
    `Style: keep replies short and natural for WhatsApp. No markdown, no bullet symbols, no long lists. One or two short sentences per turn is ideal.`,
  ].join("\n");
}

export async function handleIncoming(phone: string, text: string): Promise<string> {
  appendUser(phone, text);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(phone) },
    ...loadHistory(phone),
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
          { phone },
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
