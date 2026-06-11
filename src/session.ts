import type OpenAI from "openai";
import { db } from "./db";

type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

type ConversationRow = {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  name: string | null;
};

const HISTORY_LIMIT = 24;

export function loadHistory(phone: string): ChatMsg[] {
  const rows = db
    .prepare(
      `SELECT role, content, tool_calls, tool_call_id, name FROM conversations
       WHERE phone = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(phone, HISTORY_LIMIT) as ConversationRow[];

  const msgs: ChatMsg[] = [];
  for (const r of rows.reverse()) {
    if (r.role === "user") {
      msgs.push({ role: "user", content: r.content ?? "" });
    } else if (r.role === "assistant") {
      const tc = r.tool_calls ? JSON.parse(r.tool_calls) : undefined;
      msgs.push({
        role: "assistant",
        content: r.content,
        ...(tc ? { tool_calls: tc } : {}),
      } as ChatMsg);
    } else if (r.role === "tool" && r.tool_call_id) {
      msgs.push({
        role: "tool",
        content: r.content ?? "",
        tool_call_id: r.tool_call_id,
      });
    }
  }
  return msgs;
}

// Concatenated text of the patient's own messages since their last SUCCESSFUL
// booking — the "current booking window". Used to verify a patient_name the
// model passes was actually given by the sender for THIS booking, not lifted
// from an earlier appointment in the history. Each create_appointment result is
// stored as a tool row (name = 'create_appointment'), so a success is findable
// by its JSON content.
export function userTextSinceLastBooking(phone: string): string {
  const lastBooking = db
    .prepare(
      `SELECT id FROM conversations
       WHERE phone = ? AND role = 'tool' AND name = 'create_appointment'
         AND content LIKE '%"ok":true%'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(phone) as { id: number } | undefined;
  const sinceId = lastBooking?.id ?? 0;
  const rows = db
    .prepare(
      `SELECT content FROM conversations
       WHERE phone = ? AND role = 'user' AND id > ?
       ORDER BY id ASC`,
    )
    .all(phone, sinceId) as { content: string | null }[];
  return rows.map((r) => r.content ?? "").join("\n");
}

export function getLastMessageAt(phone: string): Date | null {
  const row = db
    .prepare(
      `SELECT created_at FROM conversations
       WHERE phone = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(phone) as { created_at: string } | undefined;
  if (!row) return null;
  // created_at is stored via SQLite datetime('now') as UTC "YYYY-MM-DD HH:MM:SS".
  return new Date(row.created_at.replace(" ", "T") + "Z");
}

export function appendUser(phone: string, content: string): void {
  db.prepare(
    `INSERT INTO conversations (phone, role, content) VALUES (?, 'user', ?)`,
  ).run(phone, content);
}

export function appendAssistant(
  phone: string,
  content: string | null,
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
): void {
  db.prepare(
    `INSERT INTO conversations (phone, role, content, tool_calls) VALUES (?, 'assistant', ?, ?)`,
  ).run(phone, content, toolCalls ? JSON.stringify(toolCalls) : null);
}

export function appendTool(
  phone: string,
  toolCallId: string,
  name: string,
  content: string,
): void {
  db.prepare(
    `INSERT INTO conversations (phone, role, content, tool_call_id, name)
     VALUES (?, 'tool', ?, ?, ?)`,
  ).run(phone, content, toolCallId, name);
}
