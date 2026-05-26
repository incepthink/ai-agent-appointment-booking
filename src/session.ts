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
