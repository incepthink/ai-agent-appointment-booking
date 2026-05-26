# Clinic WhatsApp Appointment Agent

A WhatsApp AI agent that lets patients book, reschedule, cancel, and check appointments at a single-calendar clinic through natural conversation. The agent is driven by OpenAI function calling — business rules (no double-booking, no past times, clinic hours, ownership-by-phone) are enforced in the tool layer, not just the prompt.

## Stack

- Node.js + TypeScript
- Express (webhook)
- better-sqlite3 (local persistence)
- OpenAI `gpt-4o-mini` with function calling
- WhatsApp Cloud API (Meta) — free dev tier
- Luxon for timezone math

## Project layout

```
src/
  index.ts          # Express app + /webhook + /chat (local test)
  config.ts         # env validation
  db.ts             # sqlite init + migrations
  whatsapp.ts       # Meta Cloud API: verify + send + payload parsing
  session.ts        # per-phone conversation history (sqlite)
  agent.ts          # OpenAI tool-calling loop
  tools/
    index.ts        # tool specs + dispatcher
    time.ts         # tz-aware helpers, 30-min slot grid
    slots.ts        # list_available_slots, check_slot_available
    appointments.ts # create / find / reschedule / cancel
data/clinic.db      # created on first boot
```

## Setup

```bash
npm install
cp .env.example .env   # then fill in values
npm run dev            # boots on :3000 with hot reload
```

The sqlite file is created automatically under `./data/clinic.db`.

## Environment variables

| Var | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `WHATSAPP_VERIFY_TOKEN` | Any string — must match the token you give Meta in webhook config |
| `WHATSAPP_ACCESS_TOKEN` | From Meta App → WhatsApp → API Setup → temporary or system-user token |
| `WHATSAPP_PHONE_NUMBER_ID` | The numeric ID of your test/business number |
| `WHATSAPP_API_VERSION` | Meta Graph API version (default `v21.0`) |
| `OPENAI_API_KEY` | Your OpenAI key |
| `OPENAI_MODEL` | Default `gpt-4o-mini` |
| `CLINIC_NAME` | Used in the agent's persona |
| `CLINIC_TZ` | IANA tz, e.g. `Asia/Kolkata` |
| `CLINIC_OPEN` / `CLINIC_CLOSE` | `HH:MM`, local clinic time |
| `CLINIC_DAYS` | Comma list e.g. `Mon,Tue,Wed,Thu,Fri,Sat` |
| `SLOT_MINUTES` | Slot length (default 30) |

## Run

```bash
npm run dev      # development with tsx watch
npm run build    # tsc to dist/
npm start        # node dist/index.js
```

## Connecting to WhatsApp Cloud API

1. Create a Meta App at <https://developers.facebook.com> → add the WhatsApp product.
2. Under **WhatsApp → API setup** copy:
   - the temporary access token → `WHATSAPP_ACCESS_TOKEN`
   - the test phone number's ID → `WHATSAPP_PHONE_NUMBER_ID`
3. Add your personal WhatsApp number as a recipient in the same panel.
4. Expose your local server publicly:
   ```bash
   ngrok http 3000
   ```
5. Under **WhatsApp → Configuration → Webhook**:
   - Callback URL: `https://<your-ngrok>.ngrok-free.app/webhook`
   - Verify token: same string you put in `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to the **messages** field.
6. From your WhatsApp, message the test number. The agent will respond.

## Testing the flow

### Option A — Real WhatsApp (after webhook setup above)

Try these messages from the test phone:

| You say | What should happen |
|---|---|
| "Hi, can I get an appointment tomorrow evening?" | Agent lists evening slots, asks for name and reason |
| "Name is Asha, fever check, 5pm works" | Reads back the details, asks for confirmation |
| "yes" | Books and sends confirmation |
| "What's my appointment?" | Returns your upcoming booking |
| "Move it to Saturday 11am" | Confirms then reschedules |
| "Cancel it" | Confirms then cancels |
| "Book me yesterday 3pm" | Politely refuses (past time) |
| "Book me Sunday 10am" | Says clinic is closed Sunday, suggests Saturday/Monday |

### Option B — Local `/chat` endpoint (no WhatsApp needed)

Useful for iterating on the agent without ngrok/Meta. Bypasses the WhatsApp layer entirely.

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"phone":"+919999999999","text":"Hi, can I book tomorrow at 10am?"}'
```

Each call uses the supplied `phone` as the patient identity, so you can simulate multiple patients by varying it.

### Inspect the DB

```bash
sqlite3 data/clinic.db "SELECT id, patient_name, phone, start_utc, status FROM appointments ORDER BY id DESC LIMIT 10;"
```

## How the agent works (brief)

- On every incoming message, `agent.handleIncoming(phone, text)` loads the last ~24 turns for that phone, prepends a system prompt (clinic identity, current time, hours), and calls OpenAI with the tool specs.
- If the model returns `tool_calls`, the dispatcher runs them locally and feeds results back. Loop caps at 6 iterations.
- The patient's phone is **never** a tool argument — it's injected from the webhook session into `ctx.phone`. The model literally cannot book on someone else's behalf.
- A partial unique index on `appointments(start_utc) WHERE status='booked'` is the actual double-booking guard. Even if two requests race past the in-app check, sqlite rejects the second insert and the agent offers alternatives.
- Ownership checks on reschedule/cancel ensure a patient can only touch their own bookings.
