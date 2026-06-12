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

// Splits a reply so its closing question lands as its own WhatsApp bubble. A
// reply like "…our Gynecologist. Would you like to book an appointment with
// her?" reads more naturally on WhatsApp as two messages: the body, then the
// question. Returns 1 or 2 chunks — only the TRAILING question is peeled off.
//
// We split at the LAST sentence terminator that is followed by whitespace, so
// mid-sentence dots in decimals/times ("8.30 PM") and currency ("₹800.") never
// create a false boundary. Replies that don't end in "?", or that are a single
// question with no preceding body, are returned unchanged as one chunk.
export function splitReply(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed.endsWith("?")) return [trimmed];

  // Find the last "<.|!|?><whitespace>" boundary — the start of the final sentence.
  const boundary = /[.!?]\s+/g;
  let lastEnd = -1;
  for (let m = boundary.exec(trimmed); m; m = boundary.exec(trimmed)) {
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
