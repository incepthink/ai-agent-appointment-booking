import { config } from "./config";

type IncomingTextMessage = {
  from: string;
  text: string;
  messageId: string;
};

export function extractIncoming(payload: any): IncomingTextMessage | null {
  const entry = payload?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const msg = value?.messages?.[0];

  if (!msg) {
    // This is normal — Meta also sends delivery receipts and read receipts as webhooks
    const statuses = value?.statuses;
    if (statuses) {
      console.log(`[whatsapp] status update received (${statuses[0]?.status ?? "unknown"}) — not a user message`);
    } else {
      console.log("[whatsapp] no messages in payload:", JSON.stringify(value ?? payload));
    }
    return null;
  }

  if (msg.type !== "text") {
    console.log(`[whatsapp] ignoring non-text message type: "${msg.type}" (only plain text is supported)`);
    return null;
  }

  const from: string | undefined = msg.from;
  const body: string | undefined = msg.text?.body;
  const id: string | undefined = msg.id;

  if (!from || !body || !id) {
    console.log("[whatsapp] message missing required fields:", { from, body: !!body, id });
    return null;
  }

  console.log(`[whatsapp] extracted text message — from: ${from}, id: ${id}, text: "${body}"`);
  return { from, text: body, messageId: id };
}

// Words that end in a "." but are NOT a sentence end — a boundary scan must skip
// these or it splits "Dr. Meera" into two bubbles. Lower-cased, no trailing dot.
const ABBREVIATIONS = new Set(["dr", "mr", "mrs", "ms", "prof", "sr", "jr", "st", "vs", "etc"]);

// Splits a reply into ordered WhatsApp bubbles so it reads naturally — and ONLY
// when the break is clean. A bad split is worse than none, so anything we're not
// sure about ships as a single bubble. Returns 1 or 2 chunks.
//
// Two break shapes, in priority order:
//   1. A list (slot times, doctor options) reads best with its intro line kept
//      whole above it, e.g. "…with Dr. Meera Joshi on Friday, June 12:" as one
//      bubble, then the bullets AND any trailing question together below.
//   2. Otherwise, a trailing question is peeled off its preceding sentence body
//      ("…our Gynecologist. Would you like to book?" → body, then question).
//
// The sentence scan splits at the LAST terminator followed by whitespace, but
// skips false boundaries — abbreviations ("Dr.", "Mr."), single-letter initials,
// and mid-sentence dots in decimals/times ("8.30 PM") or currency ("₹800.").
export function splitReply(text: string): string[] {
  const trimmed = text.trim();

  // 1. List-aware split: break right before the first list item, keeping the
  //    intro line(s) above as their own bubble. Only when there IS intro text
  //    above the list (index > 0); a list with nothing above it stays one chunk.
  const lines = trimmed.split("\n");
  const firstListIdx = lines.findIndex((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l));
  if (firstListIdx > 0) {
    const head = lines.slice(0, firstListIdx).join("\n").trim();
    const rest = lines.slice(firstListIdx).join("\n").trim();
    if (head && rest) return [head, rest];
    return [trimmed];
  }

  // 2. Trailing-question peel — only for replies that actually end in a question.
  if (!trimmed.endsWith("?")) return [trimmed];

  const boundary = /[.!?]\s+/g;
  let lastEnd = -1;
  for (let m = boundary.exec(trimmed); m; m = boundary.exec(trimmed)) {
    // A "." may be a false boundary: skip abbreviations and single initials so
    // "Dr. Mehta" / "A. Kumar" don't get torn apart mid-name.
    if (m[0][0] === ".") {
      const before = trimmed.slice(0, m.index);
      const word = before.match(/(\w+)$/)?.[1] ?? "";
      if (word.length === 1 || ABBREVIATIONS.has(word.toLowerCase())) continue;
    }
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd <= 0) return [trimmed];

  const body = trimmed.slice(0, lastEnd).trim();
  const question = trimmed.slice(lastEnd).trim();
  if (!body || !question) return [trimmed];

  return [body, question];
}

// How many times to attempt a send before giving up, and the base backoff.
// A transient network blip or a 429/5xx from Meta shouldn't cost the patient
// their reply, so we retry with exponential backoff. Client errors (4xx other
// than 429) won't fix themselves on retry, so we fail fast on those.
const MAX_SEND_ATTEMPTS = 3;
const SEND_BACKOFF_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendText(to: string, body: string): Promise<void> {
  const preview = body.length > 80 ? body.slice(0, 80) + "…" : body;
  console.log(`[whatsapp] sending to ${to}: "${preview}"`);

  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const payload = JSON.stringify({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: body.slice(0, 4096) },
  });

  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.whatsapp.accessToken}`,
          "Content-Type": "application/json",
        },
        body: payload,
      });

      if (res.ok) {
        const okBody = await res.json().catch(() => ({}));
        console.log(`[whatsapp] send OK (${res.status}) — messageId: ${(okBody as any)?.messages?.[0]?.id ?? "unknown"}`);
        return;
      }

      const retriable = res.status === 429 || res.status >= 500;
      const errBody = await res.text().catch(() => "");
      console.error(
        `[whatsapp] send FAILED ${res.status} (attempt ${attempt}/${MAX_SEND_ATTEMPTS}): ${errBody}`,
      );
      if (!retriable || attempt === MAX_SEND_ATTEMPTS) return;
    } catch (err) {
      // Network-level failure (DNS, connection reset, abort) — retriable.
      console.error(`[whatsapp] send error (attempt ${attempt}/${MAX_SEND_ATTEMPTS}):`, err);
      if (attempt === MAX_SEND_ATTEMPTS) return;
    }
    await sleep(SEND_BACKOFF_MS * 2 ** (attempt - 1));
  }
}

// Marks the incoming message as read (blue ticks) and shows a typing bubble —
// the patient sees activity within ~300ms instead of silence while the agent
// thinks. The indicator auto-dismisses when our reply lands (or after 25s).
// Fire-and-forget: failures are logged, never thrown, never awaited on the
// reply's critical path.
export async function sendTypingIndicator(messageId: string): Promise<void> {
  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
      typing_indicator: { type: "text" },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error(`[whatsapp] typing indicator FAILED ${res.status}: ${errBody}`);
  }
}

export function verifyWebhook(query: Record<string, string | undefined>):
  | { ok: true; challenge: string }
  | { ok: false } {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode === "subscribe" && token === config.whatsapp.verifyToken && challenge) {
    return { ok: true, challenge };
  }
  return { ok: false };
}
