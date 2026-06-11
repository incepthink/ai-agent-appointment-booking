import OpenAI from "openai";
import { config } from "./config";
import { dispatchTool, toolSpecs } from "./tools";
import {
  getActiveClinic,
  getClinicProfile,
  listActiveClinics,
  type Clinic,
  type ClinicProfile,
} from "./clinics";
import { getActiveDoctor, listClinicDoctors } from "./doctors";
import { greetingFastPath } from "./greeting";
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

// Professional, efficient conversation strategy. The patient's time is the
// scarcest resource: brief courtesy, zero filler, and every turn moves the
// booking forward. The ethical guardrails are NON-NEGOTIABLE (this is healthcare).
const CONVERSATION_STRATEGY = [
  `How to talk to patients:`,
  `- Tone: professional, courteous, efficient — a good receptionist, not a friend. Your goal is to get the patient booked with minimum back-and-forth. Once you know the patient's name use it naturally.`,
  `- Empathy: at most ONE short clause the first time the patient mentions a symptom or distress ("Sorry to hear that."), then immediately the practical next step. NEVER repeat sympathy or apologies in later turns — if the situation hasn't changed, go straight to the action.`,
  `- No filler: never open with exclamations like "Great choice!" or "Great!", never close with offers of further help ("feel free to ask!", "if you have any other questions..."), never restate information the patient already has. If a message needs no action (e.g. "ok" or "thanks" after everything is done), reply with one short acknowledgement like "You're all set." and nothing more.`,
  `- When directly relevant, answer a patient worry (cost, insurance, location, parking) in one short sentence using the clinic info above — don't make them ask, and don't volunteer more than that.`,
  `- If the patient hesitates, surface ONE genuine, relevant strength of the clinic or doctor that addresses THAT specific worry (e.g. cost → follow-ups are half price). One sentence, never generic bragging.`,
  `- End every reply with exactly one concrete next step or question that moves the booking forward. For times, offer 1-2 specific available slots ("5:00 PM today or 11:00 AM tomorrow — book one?") rather than an open "when works for you?".`,
  `- Handle reluctance by offering an alternative (a different time or doctor), not pressure. If it's still a no, accept it in one sentence.`,
  `- Abusive or off-topic messages: do not console or engage; reply with one neutral sentence redirecting to booking.`,
  ``,
  `Ethical guardrails (never break these):`,
  `- You are a receptionist, not a clinician. Never give medical advice, diagnose, interpret symptoms, or judge how urgent something is. Steer medical questions to booking a doctor.`,
  `- If a message sounds like an emergency (chest pain, trouble breathing, severe bleeding, etc.), advise ONCE, plainly: they should contact emergency services or call the clinic right away — include the clinic's contact number from the clinic info above (if no number is set, say "call the clinic directly"). Do not start booking in that same advisory message.`,
  `- Patient autonomy: if after that advisory the patient still wants an appointment, respect their choice immediately — NEVER refuse a booking, never repeat the warning, no fresh apologies. Proceed with the normal booking flow, pushing the EARLIEST available slot with the most suitable doctor ("the soonest I have is ..."). Urgency does NOT waive the patient name: if you don't have it yet, ask for it in the SAME message that offers the earliest slot, and never book under a placeholder. In the booking confirmation sentence, ALWAYS append one short clause that they can still call the clinic at that number if it gets worse — this clause is required for emergency-symptom bookings and overrides the "confirm and stop" rule.`,
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

// Active clinics, embedded directly in the system prompt so the model can
// present options without burning an LLM round-trip on list_clinics. Changes
// only when a clinic is added/renamed, so it's safe in the cacheable prefix.
function clinicListBlock(): string {
  const clinics = listActiveClinics();
  if (clinics.length === 0) return `Available clinics:\n  (No clinics are configured yet.)`;
  const lines = clinics.map((c) => {
    const desc = getClinicProfile(c.id)?.description;
    return `  - ${c.name} [code ${c.code}]${desc ? ` — ${desc}` : ""}`;
  });
  return [`Available clinics:`, ...lines].join("\n");
}

function systemPrompt(phone: string, clinic: Clinic | null, freshStart: boolean): string {
  // Static-first ordering: everything that changes per turn or per patient
  // (current time, phone, session state) lives in the trailing "Session
  // context" block. That keeps the long prefix byte-identical across turns —
  // and across patients of the same clinic — so OpenAI's automatic prompt
  // caching keeps hitting instead of being busted by a timestamp on line 3.
  const style = `Style: professional and brief — this is WhatsApp and the patient's time matters. One or two short sentences per turn; a booking confirmation can be one compact line with all details. No markdown, no bullet symbols, no emoji, no pleasantry padding.`;
  const multiClinic = `You serve several clinics from one WhatsApp number. The patient can switch clinics anytime by asking — when they do, call select_clinic with the new clinic's code (the clinics are listed above; only call list_clinics if that list seems stale or missing).`;
  const phoneLine = `The patient's WhatsApp number is ${phone}. You already know it — never ask for it and never pass it to tools.`;

  if (!clinic) {
    return [
      `You are a professional receptionist booking appointments across several clinics, over WhatsApp.`,
      `The patient has NOT picked a clinic yet, so you cannot book anything until one is selected.`,
      ``,
      clinicListBlock(),
      ``,
      `On the patient's first message (any greeting like "hi", "hey", "hello"), reply with one compact message: a one-sentence introduction (you can help book, reschedule, or cancel appointments) followed by the clinic options from the list above so they can choose one.`,
      `When the patient names or picks a clinic, call select_clinic with its code before doing anything else.`,
      `Do not ask for booking details (name, date, time) until a clinic has been selected.`,
      ``,
      multiClinic,
      ``,
      style,
      ``,
      `Session context:`,
      phoneLine,
    ].join("\n");
  }

  const doctors = listClinicDoctors(clinic.id);
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
    `Doctors at ${clinic.name}:`,
    roster,
    ``,
    ...(knowledge ? [knowledge, ``] : []),
    clinicListBlock(),
    ``,
    `How to choose a doctor (do this BEFORE checking slots or booking):`,
    `- First find out the patient's REASON for visit if you don't already know it.`,
    `- Based on that reason, recommend the single most suitable doctor from the list above, with one short sentence on why (e.g. a skin problem → the dermatologist). Ask if that doctor works for them.`,
    `- If the patient agrees, call select_doctor with that doctor's code, then continue to date and time.`,
    `- If the patient declines or asks for other options, briefly list the other doctors (name + specialty) and let them pick; then call select_doctor for their choice.`,
    `- Each doctor has their OWN hours and calendar. Always use list_available_slots / check_slot_available for the SELECTED doctor — never quote one doctor's availability for another.`,
    ``,
    `What you need to book: the doctor, patient name, preferred date, preferred time, and reason for visit. Ask ONLY for what's still missing, and do NOT ask for final confirmation until all five are known.`,
    `The person messaging may be booking for someone else — a family member, friend, or someone they care for — not for themselves. The "patient name" is the actual name of the person who will be seen by the doctor. If the patient is referred to only by their relationship to the sender (for example "my grandmother", "my son", "for my wife") or by anything that isn't an actual name, treat the name as still MISSING and ask for it before booking — never store a relationship word as the patient's name. If the sender is clearly booking for themselves and you don't yet have their name, ask for it the same way. NEVER invent or substitute a placeholder such as "Patient" or "Unknown" — if the sender has not given a real name, the name is MISSING and you must ask for it before calling create_appointment, no exceptions. A patient name from an EARLIER booking in this conversation does NOT carry over: each new booking may be for a different person, so at the start of every new booking treat the patient name as MISSING and use only a name the sender gives you for THIS booking — never reuse, infer, or assume the name from a previous appointment, even one you booked moments ago.`,
    ``,
    `Rules:`,
    `- If the patient sends a greeting (like "hi", "hey", "hello") mid-conversation, reintroduce yourself in ONE short sentence: you are the receptionist for ${clinic.name}, you can book, reschedule, or cancel appointments, and they can switch clinics by asking.`,
    `- If the patient wants a different clinic, call select_clinic with the new clinic's code from the list above (this resets the chosen doctor). NEW bookings always apply to the currently selected clinic and doctor. Reschedules and cancellations apply to whichever clinic/doctor the chosen appointment belongs to (find_appointments returns appointments across all clinics, each with its clinic_name and doctor_name).`,
    `- Always name the doctor and clinic when confirming a booking, reschedule, or cancellation, and when listing appointments (e.g. "9:00 AM with Dr. Mehta at Lotus Multi-Speciality"). When listing appointments from find_appointments, include the clinic_name and doctor_name for each one.`,
    `- Whenever a requested time is unavailable for any reason (outside the doctor's hours, doctor not in that day, or slot already taken), always call list_available_slots for that date and include the doctor's hours plus the available slots in your reply so the patient can pick one directly.`,
    `- Use get_current_datetime whenever the user says "today", "tomorrow", "this evening", etc.`,
    `- Never invent or guess available slots or which doctor is free. Always verify with list_available_slots or check_slot_available for the selected doctor.`,
    `- Never book a time in the past or outside the selected doctor's hours.`,
    `- Before calling create_appointment, reschedule_appointment, or cancel_appointment, repeat the full details back (including the doctor) in ONE plain sentence — never a bulleted or formatted list — and get an explicit yes from the patient.`,
    `- After a booking, reschedule, or cancellation succeeds, confirm it in one compact plain sentence and stop — no lists, no "arrive early" advice unless the clinic info says so, no closing offers of further help.`,
    `- If a requested slot is taken, offer 2-3 nearby alternatives for that doctor.`,
    `- For reschedule/cancel, first look up the patient's existing booking with find_appointments.`,
    ``,
    CONVERSATION_STRATEGY,
    ``,
    multiClinic,
    ``,
    style,
    ``,
    // Everything below changes per turn/patient — keep it last (see note above).
    `Session context:`,
    `Current local time: ${nowInClinicTz(clinic).toFormat("cccc, LLL d yyyy, h:mm a")} (${clinic.tz}).`,
    phoneLine,
    (() => {
      const activeDoctor = getActiveDoctor(phone);
      return activeDoctor
        ? `The patient is currently booking with ${activeDoctor.name} (${activeDoctor.specialty}).`
        : `No doctor has been chosen yet for this booking.`;
    })(),
    ...(freshStart
      ? [
          `This is the start of a NEW conversation (the patient hasn't messaged in a while). On their first message, reply with one compact message — a one-sentence reintroduction (you book, reschedule, and cancel appointments across several clinics), the clinic options from the list above, and a note that they were last booking with ${clinic.name}, asking whether to continue there or pick a different one. Do NOT assume ${clinic.name} for a new booking until they confirm or choose.`,
        ]
      : []),
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

  // A bare "hi" starting a new conversation always gets the same welcome —
  // answer it from a template (0 LLM calls) instead of paying for the model.
  if (freshStart) {
    const fastReply = greetingFastPath(phone, text, clinic);
    if (fastReply) {
      appendAssistant(phone, fastReply);
      console.log(`[agent] greeting fast-path reply (0 LLM calls)`);
      return done(fastReply);
    }
  }

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
      // Low temperature for focused, consistent, no-frills receptionist replies.
      temperature: 0.3,
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
