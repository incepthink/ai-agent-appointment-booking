import { config } from "./config";

// One-shot script: registers (activates) the WhatsApp number on the Cloud API.
// This is what moves the number from "Pending" → "Connected" so customers can
// message it and wa.me works. For Cloud-hosted numbers the two-step-verification
// PIN is set here, as part of /register — not via the WhatsApp Manager UI toggle.
//
// Run: npm run register -- <6-digit-pin>
//   or set WHATSAPP_2FA_PIN in .env and run: npm run register
//
// Keep the PIN — it is required for any future re-registration of this number.

async function main() {
  const pin = process.env.WHATSAPP_2FA_PIN ?? process.argv[2];

  if (!pin || !/^\d{6}$/.test(pin)) {
    console.error(
      "A 6-digit PIN is required.\n" +
        "  Usage:  npm run register -- 123456\n" +
        "  Or set WHATSAPP_2FA_PIN=123456 in .env and run: npm run register",
    );
    process.exit(1);
  }

  const { apiVersion, phoneNumberId, accessToken } = config.whatsapp;
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/register`;

  console.log(`[register] registering phone number ${phoneNumberId} (${apiVersion})…`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      pin,
    }),
  });

  const bodyText = await res.text();

  if (!res.ok) {
    console.error(`[register] FAILED ${res.status}: ${bodyText}`);
    console.error(
      "\nCommon causes:\n" +
        "  • 401 / token error      → access token expired (regenerate it in the dashboard)\n" +
        "  • display name pending   → wait for name review, then re-run\n" +
        "  • business not verified  → complete business verification, then re-run",
    );
    process.exit(1);
  }

  console.log(`[register] OK (${res.status}): ${bodyText}`);
  console.log(
    "\nRegistered. Check WhatsApp Manager → Phone numbers — status should move to " +
      "Connected shortly. Then wa.me/<number> will allow starting a chat.",
  );
}

main().catch((err) => {
  console.error("[register] unexpected error:", err);
  process.exit(1);
});
