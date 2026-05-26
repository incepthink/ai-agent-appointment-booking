import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "clinic.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS appointments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_name TEXT NOT NULL,
    phone        TEXT NOT NULL,
    start_utc    TEXT NOT NULL,
    end_utc      TEXT NOT NULL,
    reason       TEXT,
    status       TEXT NOT NULL DEFAULT 'booked',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_active_slot
    ON appointments(start_utc) WHERE status = 'booked';

  CREATE INDEX IF NOT EXISTS ix_phone ON appointments(phone);

  CREATE TABLE IF NOT EXISTS conversations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    phone        TEXT NOT NULL,
    role         TEXT NOT NULL,
    content      TEXT,
    tool_calls   TEXT,
    tool_call_id TEXT,
    name         TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS ix_conv_phone ON conversations(phone, id);
`);

export type AppointmentRow = {
  id: number;
  patient_name: string;
  phone: string;
  start_utc: string;
  end_utc: string;
  reason: string | null;
  status: "booked" | "cancelled";
  created_at: string;
};
