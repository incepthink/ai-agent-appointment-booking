import express from "express";
import cors from "cors";
import { config } from "./config";
import { handleIncoming } from "./agent";
import { listActiveClinics } from "./clinics";
import { extractIncoming, sendText, verifyWebhook } from "./whatsapp";
import { apiRouter } from "./api";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Dashboard (separate Next.js app) calls the REST API cross-origin.
app.use(cors({ origin: config.dashboardOrigins }));
app.use("/api", apiRouter);

// Simple in-process dedupe for WhatsApp at-least-once delivery
const seenMessageIds = new Set<string>();
function rememberId(id: string) {
  seenMessageIds.add(id);
  if (seenMessageIds.size > 500) {
    const first = seenMessageIds.values().next().value;
    if (first) seenMessageIds.delete(first);
  }
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/webhook", (req, res) => {
  console.log("[webhook] verification request:", req.query);
  const result = verifyWebhook(req.query as Record<string, string | undefined>);
  if (result.ok) {
    console.log("[webhook] verification successful");
    return res.status(200).send(result.challenge);
  }
  console.warn("[webhook] verification FAILED — token mismatch");
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  // ACK Meta immediately so they don't retry
  res.sendStatus(200);

  // Log the full raw payload so we can see exactly what Meta sends
  console.log("[webhook] POST received:", JSON.stringify(req.body, null, 2));

  try {
    const incoming = extractIncoming(req.body);
    if (!incoming) {
      console.log("[webhook] no actionable message extracted — ignoring");
      return;
    }

    if (seenMessageIds.has(incoming.messageId)) {
      console.log(
        `[webhook] duplicate messageId ${incoming.messageId} — skipping`,
      );
      return;
    }
    rememberId(incoming.messageId);

    console.log(
      `[webhook] processing message from ${incoming.from}: "${incoming.text}"`,
    );

    const reply = await handleIncoming(incoming.from, incoming.text);
    console.log(`[webhook] agent reply: "${reply}"`);

    await sendText(incoming.from, reply);
    console.log(`[webhook] reply dispatched to ${incoming.from}`);
  } catch (err) {
    console.error("[webhook] unhandled error:", err);
  }
});

// POST /chat — local test endpoint that bypasses WhatsApp
// Body: { phone: string, text: string } → { reply: string }
app.post("/chat", async (req, res) => {
  const { phone, text } = req.body ?? {};
  if (typeof phone !== "string" || typeof text !== "string") {
    return res
      .status(400)
      .json({ error: "phone and text are required strings" });
  }
  try {
    const reply = await handleIncoming(phone, text);
    res.json({ reply });
  } catch (err: any) {
    console.error("[chat] error:", err);
    res.status(500).json({ error: err?.message ?? "internal error" });
  }
});

app.listen(config.port, () => {
  const clinics = listActiveClinics();
  console.log(
    `[clinic-agent] listening on :${config.port} — serving ${clinics.length} clinic(s): ` +
      clinics.map((c) => `${c.name} [${c.code}] (${c.tz})`).join(", "),
  );
});
