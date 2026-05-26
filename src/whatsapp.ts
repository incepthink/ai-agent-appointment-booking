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

export async function sendText(to: string, body: string): Promise<void> {
  const preview = body.length > 80 ? body.slice(0, 80) + "…" : body;
  console.log(`[whatsapp] sending to ${to}: "${preview}"`);

  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: body.slice(0, 4096) },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error(`[whatsapp] send FAILED ${res.status}: ${errBody}`);
  } else {
    const okBody = await res.json().catch(() => ({}));
    console.log(`[whatsapp] send OK (${res.status}) — messageId: ${(okBody as any)?.messages?.[0]?.id ?? "unknown"}`);
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
