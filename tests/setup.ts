import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

// --- Isolated DB per test file ---------------------------------------------
// This runs before the test file (and therefore before src/db.ts) is imported,
// so pointing CLINIC_DB_PATH at a fresh temp file gives every test file its own
// database. db.ts seeds the SUNRISE / HARBOR / LOTUS clinics + doctors on a
// fresh DB, so those act as deterministic fixtures with zero extra setup.
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "clinic-test-"));
const dbFile = path.join(dbDir, `${crypto.randomUUID()}.db`);
process.env.CLINIC_DB_PATH = dbFile;

// --- Dummy env so config.ts's zod schema parses --------------------------- -
// These are never used to hit a real service in unit/integration tests (the
// OpenAI client is mocked, WhatsApp is never called). They just satisfy the
// required-string checks at import time.
const dummies: Record<string, string> = {
  WHATSAPP_VERIFY_TOKEN: "test-verify",
  WHATSAPP_ACCESS_TOKEN: "test-access",
  WHATSAPP_PHONE_NUMBER_ID: "test-phone-id",
  WHATSAPP_WABA_ID: "test-waba",
  OPENAI_API_KEY: "test-openai-key",
};
for (const [k, v] of Object.entries(dummies)) {
  if (!process.env[k]) process.env[k] = v;
}

// Best-effort cleanup of the throwaway DB (and its WAL/SHM siblings).
process.on("exit", () => {
  try {
    fs.rmSync(dbDir, { recursive: true, force: true });
  } catch {
    /* temp dir — fine to leak if the OS holds a handle */
  }
});
