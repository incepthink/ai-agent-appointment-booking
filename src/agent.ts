import OpenAI from "openai";
import { config } from "./config";
import { dispatchTool, toolSpecs } from "./tools";
import { getActiveClinic, getClinicProfile, type Clinic, type ClinicProfile } from "./clinics";
import { getActiveDoctor, listClinicDoctors } from "./doctors";
import { nowInClinicTz } from "./tools/time";
import {
  appendAssistant,
  appendTool,
  appendUser,
  getLastMessageAt,
  loadHistory,
} from "./session";
import type { TurnMetrics } from "./metrics";

const client = new OpenAI({ apiKey: config.openai.apiKey });

const MAX_ITERATIONS = 6;

// How long without any message before we treat the next one as a new conversation
// (re-welcome the patient and let them re-pick their clinic). Easy to tune.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

// Warm, consultative conversation strategy. This is what turns a curious patient
// into a booked one without ever feeling pushy. Goal: be genuinely helpful and
// reassuring, remove friction, and always leave the patient with one easy next
// step. The ethical guardrails are NON-NEGOTIABLE (this is healthcare).
const CONVERSATION_STRATEGY = [
  `How to talk to patients:`,
  `- Be warm and human. Acknowledge how the patient feels before getting practical (e.g. "That sounds uncomfortable — let's get you seen quickly."). Once you know the patient's name use it naturally; it's also fine to address the sender by their own name when they're booking for someone else.`,
  `- Reduce friction: when it's relevant, proactively answer the things patients worry about (cost, insurance, location, parking, what to bring) using the clinic info above — don't make them ask.`,
  `- If the patient hesitates, gently surface ONE genuine, relevant strength of the clinic or doctor that addresses THAT specific worry (e.g. cost → mention follow-ups are half price; nervous → mention the doctor explains things clearly). Never generic bragging.`,
  `- Always end a booking-intent turn with one concrete, easy next step: offer 1-2 specific available slots ("I have 5:00 PM today or 11:00 AM tomorrow — want me to grab one?") rather than an open "when works for you?".`,
  `- Handle reluctance by offering alternatives (a different time, or another suitable doctor), not pressure. If it's still a no, be gracious and leave the door open.`,
  ``,
  `Ethical guardrails (never break these):`,
  `- You are a receptionist, not a clinician. Never give medical advice, diagnose, interpret symptoms, or judge how urgent something is. Steer medical questions to booking a doctor.`,
  `- If a message sounds like an emergency (chest pain, trouble breathing, severe bleeding, etc.), tell the patient to contact emergency services or call the clinic directly right away — do not try to book a routine slot.`,
  `- Never invent or exaggerate scarcity or urgency. Only state real availability from the tools.`,
  `- Never make up facts about pricing, services, or insurance. If something isn't in the clinic info above, say you'll have the clinic confirm and share the contact number rather than guessing.`,
].join("\n");

// Builds the "about the clinic" block the agent uses to answer patient questions
// and personalise the conversation. Returns "" when nothing is set so empty
// fields add zero prompt noise. (Today this is a direct DB read; if the knowledge
// base ever grows large this is the natural seam to swap in retrieval/RAG.)
function clinicKnowledgeBlock(clinicId: number): string {
  const profile: ClinicProfile | null = getClinicProfile(clinicId);
  if (!profile) return "";
  const lines: string[] = [];
  if (profile.description) lines.push(profile.description);
  if (profile.address) lines.push(`Address: ${profile.address}`);
  if (profile.contactPhone) lines.push(`Contact: ${profile.contactPhone}`);
  if (profile.knowledge) lines.push(profile.knowledge);
  if (lines.length === 0) return "";
  return [`About ${profile.name} (use this to answer questions and reassure patients):`, ...lines].join(
    "\n",
  );
}

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
      `Be warm and welcoming from the first message — you want the patient to feel they're in good hands. Once they pick a clinic you'll have more details to help them with.`,
      ``,
      ...common,
    ].join("\n");
  }

  const now = nowInClinicTz(clinic);
  const doctors = listClinicDoctors(clinic.id);
  const activeDoctor = getActiveDoctor(phone);
  const roster = doctors.length
    ? doctors
        .map(
          (d) =>
            `  - ${d.name} [code ${d.code}] — ${d.specialty}. Hours ${d.open}-${d.close}, ${d.days.join(", ")}.${d.bio ? ` ${d.bio}` : ""}`,
        )
        .join("\n")
    : "  (No doctors are configured at this clinic yet.)";

  const knowledge = clinicKnowledgeBlock(clinic.id);

  return [
    `You are the receptionist for "${clinic.name}", which has several doctors. You chat with patients over WhatsApp.`,
    ``,
    `Current local time: ${now.toFormat("cccc, LLL d yyyy, h:mm a")} (${clinic.tz}).`,
    ``,
    `Doctors at ${clinic.name}:`,
    roster,
    ``,
    ...(knowledge ? [knowledge, ``] : []),
    activeDoctor
      ? `The patient is currently booking with ${activeDoctor.name} (${activeDoctor.specialty}).`
      : `No doctor has been chosen yet for this booking.`,
    ``,
    `How to choose a doctor (do this BEFORE checking slots or booking):`,
    `- First find out the patient's REASON for visit if you don't already know it.`,
    `- Based on that reason, recommend the single most suitable doctor from the list above, with one short sentence on why (e.g. a skin problem → the dermatologist). Ask if that doctor works for them.`,
    `- If the patient agrees, call select_doctor with that doctor's code, then continue to date and time.`,
    `- If the patient declines or asks for other options, briefly list the other doctors (name + specialty) and let them pick; then call select_doctor for their choice.`,
    `- Each doctor has their OWN hours and calendar. Always use list_available_slots / check_slot_available for the SELECTED doctor — never quote one doctor's availability for another.`,
    ``,
    `What you need to book: the doctor, patient name, preferred date, preferred time, and reason for visit. Ask ONLY for what's still missing.`,
    `The person messaging may be booking for someone else — a family member, friend, or someone they care for — not for themselves. The "patient name" is the actual name of the person who will be seen by the doctor. If the patient is referred to only by their relationship to the sender (for example "my grandmother", "my son", "for my wife") or by anything that isn't an actual name, treat the name as still MISSING and ask for it before booking — never store a relationship word as the patient's name. If the sender is clearly booking for themselves and you don't yet have their name, ask for it the same way.`,
    ``,
    `Rules:`,
    freshStart
      ? `- This is the start of a new conversation (the patient hasn't messaged in a while). On their first message (any greeting like "hi", "hey", "hello", etc.), treat it as a fresh start: introduce yourself, say you can help book, reschedule, or cancel appointments, and mention you serve several clinics. Note that they were last booking with ${clinic.name}, then call list_clinics and ask whether they'd like to continue with ${clinic.name} or pick a different one. Do NOT assume ${clinic.name} for a new booking until they confirm or choose.`
      : `- If the patient sends a greeting (like "hi", "hey", "hello"), briefly reintroduce that you are the receptionist for ${clinic.name} and can help book, reschedule, or cancel appointments — and that they can switch clinics anytime by asking. Keep it to one or two short sentences.`,
    `- If the patient wants a different clinic, call list_clinics and/or select_clinic (this resets the chosen doctor). NEW bookings always apply to the currently selected clinic and doctor. Reschedules and cancellations apply to whichever clinic/doctor the chosen appointment belongs to (find_appointments returns appointments across all clinics, each with its clinic_name and doctor_name).`,
    `- Always name the doctor and clinic when confirming a booking, reschedule, or cancellation, and when listing appointments (e.g. "9:00 AM with Dr. Mehta at Lotus Multi-Speciality"). When listing appointments from find_appointments, include the clinic_name and doctor_name for each one.`,
    `- Whenever a requested time is unavailable for any reason (outside the doctor's hours, doctor not in that day, or slot already taken), always call list_available_slots for that date and include the doctor's hours plus the available slots in your reply so the patient can pick one directly.`,
    `- Use get_current_datetime whenever the user says "today", "tomorrow", "this evening", etc.`,
    `- Never invent or guess available slots or which doctor is free. Always verify with list_available_slots or check_slot_available for the selected doctor.`,
    `- Never book a time in the past or outside the selected doctor's hours.`,
    `- Before calling create_appointment, reschedule_appointment, or cancel_appointment, repeat the full details back (including the doctor) and get an explicit yes from the patient.`,
    `- If a requested slot is taken, offer 2-3 nearby alternatives for that doctor.`,
    `- For reschedule/cancel, first look up the patient's existing booking with find_appointments.`,
    ``,
    CONVERSATION_STRATEGY,
    ``,
    ...common,
  ].join("\n");
}

export async function handleIncoming(
  phone: string,
  text: string,
): Promise<{ reply: string; metrics: TurnMetrics }> {
  // Read last-seen time BEFORE appending the just-arrived message so it doesn't count.
  const lastSeen = getLastMessageAt(phone);
  const freshStart = !lastSeen || Date.now() - lastSeen.getTime() > STALE_AFTER_MS;

  appendUser(phone, text);

  const clinic = getActiveClinic(phone);
  console.log(`[agent] phone=${phone} active_clinic=${clinic ? `${clinic.name} [${clinic.code}]` : "none"} fresh_start=${freshStart}`);

  // Accumulate per-turn latency/token metrics; the caller persists them with the
  // end-to-end and WhatsApp-send timings it owns. done() tags every return path.
  const metrics: TurnMetrics = {
    clinicId: clinic?.id ?? null,
    model: config.openai.model,
    llmCalls: 0,
    llmMs: 0,
    toolCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
  };
  const done = (reply: string) => ({ reply, metrics });

  const history = loadHistory(phone);
  console.log(`[agent] history_msgs=${history.length}`);

  const prompt = systemPrompt(phone, clinic, freshStart);
  console.log(`[agent] system_prompt_head=${prompt.slice(0, 120).replace(/\n/g, " | ")}`);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: prompt },
    ...history,
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const llmStart = Date.now();
    const completion = await client.chat.completions.create({
      model: config.openai.model,
      messages,
      tools: toolSpecs,
      tool_choice: "auto",
      // Slightly above neutral for warmer, more natural phrasing without drifting
      // off the booking task.
      temperature: 0.4,
    });
    metrics.llmCalls += 1;
    metrics.llmMs += Date.now() - llmStart;
    const usage = completion.usage;
    metrics.promptTokens += usage?.prompt_tokens ?? 0;
    metrics.completionTokens += usage?.completion_tokens ?? 0;
    // prompt_tokens_details may be absent in older SDK types — read defensively.
    metrics.cachedTokens += (usage as any)?.prompt_tokens_details?.cached_tokens ?? 0;

    const msg = completion.choices[0]?.message;
    if (!msg) {
      const fallback = "Sorry, I didn't catch that. Could you say it again?";
      appendAssistant(phone, fallback);
      return done(fallback);
    }

    const toolCalls = msg.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      metrics.toolCalls += toolCalls.length;
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
    return done(reply);
  }

  const fallback = "Sorry, I'm having trouble completing that right now. Please try again in a moment.";
  appendAssistant(phone, fallback);
  return done(fallback);
}
