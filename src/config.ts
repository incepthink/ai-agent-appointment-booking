import "dotenv/config";
import { z } from "zod";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
type Day = (typeof DAYS)[number];

const schema = z.object({
  PORT: z.coerce.number().default(3000),

  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_WABA_ID: z.string().min(1),
  WHATSAPP_API_VERSION: z.string().default("v21.0"),
  // Pause between sequential reply bubbles (e.g. body, then trailing question)
  // so they arrive in order. 0 disables the pause.
  WHATSAPP_INTER_MESSAGE_DELAY_MS: z.coerce.number().int().min(0).default(600),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),

  JWT_SECRET: z.string().min(1).default("dev-insecure-change-me"),
  ADMIN_API_KEY: z.string().min(1).default("dev-admin-key-change-me"),
  // Comma-separated list of browser origins allowed to call the REST API (CORS).
  DASHBOARD_ORIGIN: z.string().default("http://localhost:3001"),

  CLINIC_NAME: z.string().default("The Clinic"),
  CLINIC_TZ: z.string().default("Asia/Kolkata"),
  CLINIC_OPEN: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  CLINIC_CLOSE: z.string().regex(/^\d{2}:\d{2}$/).default("18:00"),
  CLINIC_DAYS: z.string().default("Mon,Tue,Wed,Thu,Fri,Sat"),
  SLOT_MINUTES: z.coerce.number().int().positive().default(30),
});

const env = schema.parse(process.env);

const parsedDays = env.CLINIC_DAYS.split(",")
  .map((d) => d.trim())
  .filter((d): d is Day => (DAYS as readonly string[]).includes(d));

if (parsedDays.length === 0) {
  throw new Error(`CLINIC_DAYS must contain at least one of ${DAYS.join(",")}`);
}

export const config = {
  port: env.PORT,
  whatsapp: {
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    wabaId: env.WHATSAPP_WABA_ID,
    apiVersion: env.WHATSAPP_API_VERSION,
    interMessageDelayMs: env.WHATSAPP_INTER_MESSAGE_DELAY_MS,
  },
  openai: {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
  },
  jwtSecret: env.JWT_SECRET,
  adminApiKey: env.ADMIN_API_KEY,
  dashboardOrigins: env.DASHBOARD_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0),
  clinic: {
    name: env.CLINIC_NAME,
    tz: env.CLINIC_TZ,
    open: env.CLINIC_OPEN,
    close: env.CLINIC_CLOSE,
    days: parsedDays,
    slotMinutes: env.SLOT_MINUTES,
  },
} as const;

export type AppConfig = typeof config;
