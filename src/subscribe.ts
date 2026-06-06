import { config } from "./config";

// One-shot script: subscribes THIS app to the production WhatsApp Business Account
// (WABA) so that real, customer-initiated messages are delivered to our webhook.
//
// The dashboard showing the WABA as "connected" is NOT the same as this API-level
// subscription. Without it, Meta's manual webhook test still works, but live
// customer messages never produce a POST — which is the "no reply" symptom.
//
// Run: npm run subscribe

async function main() {
  const { apiVersion, wabaId, accessToken } = config.whatsapp;
  const url = `https://graph.facebook.com/${apiVersion}/${wabaId}/subscribed_apps`;
  const auth = { Authorization: `Bearer ${accessToken}` };

  // 1) Show what's currently subscribed.
  console.log(`[subscribe] current subscriptions for WABA ${wabaId}…`);
  const getRes = await fetch(url, { headers: auth });
  const getBody = await getRes.text();
  if (!getRes.ok) {
    console.error(`[subscribe] GET FAILED ${getRes.status}: ${getBody}`);
    console.error(
      "\nIf this is a permissions/token error, the access token isn't scoped to " +
        "this WABA — regenerate a System User token with whatsapp_business_management.",
    );
    process.exit(1);
  }
  console.log(`[subscribe] GET (${getRes.status}): ${getBody}`);

  // 2) Subscribe this app to the WABA (safe to repeat — idempotent).
  console.log(`[subscribe] subscribing this app to WABA ${wabaId}…`);
  const postRes = await fetch(url, { method: "POST", headers: auth });
  const postBody = await postRes.text();
  if (!postRes.ok) {
    console.error(`[subscribe] POST FAILED ${postRes.status}: ${postBody}`);
    process.exit(1);
  }

  console.log(`[subscribe] POST OK (${postRes.status}): ${postBody}`);
  console.log(
    "\nApp subscribed to the WABA. Now restart the service and send a BRAND-NEW " +
      "message (different text) from a real phone, while watching the logs.",
  );
}

main().catch((err) => {
  console.error("[subscribe] unexpected error:", err);
  process.exit(1);
});
