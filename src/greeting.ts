import { listActiveClinics, setActiveClinic, type Clinic } from "./clinics";

// Zero-LLM fast path for the very first "hi" of a conversation. A pure
// greeting carries no intent the model could act on — the reply is always
// "welcome + pick a clinic" — so we answer from a template instead of paying
// 1-2 OpenAI round-trips. Anything that isn't OBVIOUSLY a bare greeting must
// fall through to the LLM, so the whitelist below stays deliberately narrow.

const GREETING_RE =
  /^(?:hi+|hey+|heya|hello+|helo|yo|hai|hola|namaste|namaskar|gm|good (?:morning|afternoon|evening|day))(?: (?:there|team|doctor|dr|sir|madam|ji))?$/;

export function isPureGreeting(text: string): boolean {
  // Lowercase, then drop everything that isn't a letter or space (punctuation,
  // emoji, digits) so "Hi!!" or "hello 👋" normalize to the bare word.
  const t = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 25) return false;
  return GREETING_RE.test(t);
}

// Templated welcome, written to match the system prompt's tone rules: no
// filler, no emoji, ends with exactly one concrete question.
export function greetingFastPath(phone: string, text: string, lastClinic: Clinic | null): string | null {
  if (!isPureGreeting(text)) return null;

  const clinics = listActiveClinics();
  if (clinics.length === 0) return null; // let the LLM handle the odd empty setup

  // Single-clinic deployment: there is nothing to choose, so select it now and
  // skip the clinic-selection turn entirely.
  if (clinics.length === 1) {
    const only = clinics[0];
    if (!lastClinic || lastClinic.id !== only.id) setActiveClinic(phone, only.id);
    return `Hello, this is ${only.name}. I can help you book, reschedule, or cancel an appointment. What can I do for you?`;
  }

  const names = clinics.map((c) => c.name);
  const options =
    names.length === 2 ? names.join(" or ") : `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;

  if (lastClinic) {
    return `Hello, I can help you book, reschedule, or cancel appointments. You were last booking with ${lastClinic.name} — continue there, or pick another clinic: ${options}?`;
  }
  return `Hello, I can help you book, reschedule, or cancel appointments. Which clinic would you like — ${options}?`;
}
