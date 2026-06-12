import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the OpenAI SDK so the agent loop runs with scripted completions — no
// network, no tokens, fully deterministic. The shared mockCreate lets each test
// drive the model's responses.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock("openai", () => ({
  // `new OpenAI(...)` must be constructable — a class is the cleanest mock.
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

import { handleIncoming } from "../../src/agent";
import { getActiveClinic } from "../../src/clinics";
import { db } from "../../src/db";
import { freezeNow, resetDynamicData } from "../helpers";

// --- completion builders ----------------------------------------------------
function textCompletion(content: string) {
  return { choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 10, completion_tokens: 4 } };
}
function toolCompletion(name: string, args: Record<string, unknown>, id = "call_1") {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 6 },
  };
}

describe("agent loop (mocked LLM)", () => {
  let restore: () => void;
  beforeEach(() => {
    resetDynamicData();
    mockCreate.mockReset();
    restore = freezeNow();
  });
  afterEach(() => restore?.());

  it("runs a tool call, feeds the result back, and returns the follow-up text", async () => {
    mockCreate
      .mockResolvedValueOnce(toolCompletion("select_clinic", { code: "LOTUS" }))
      .mockResolvedValueOnce(textCompletion("You're booking at Lotus. What do you need?"));

    const phone = "+1agent1";
    const { reply, metrics } = await handleIncoming(phone, "I want Lotus clinic");

    expect(reply).toMatch(/Lotus/);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(metrics.llmCalls).toBe(2);
    expect(metrics.toolCalls).toBe(1);
    // The tool actually ran: the session now points at LOTUS.
    expect(getActiveClinic(phone)?.code).toBe("LOTUS");
    // And a tool-result row was persisted.
    const toolRows = db
      .prepare(`SELECT COUNT(*) c FROM conversations WHERE phone = ? AND role='tool'`)
      .get(phone) as any;
    expect(toolRows.c).toBe(1);
  });

  it("caps runaway tool-calling at MAX_ITERATIONS and degrades gracefully", async () => {
    // Model never stops calling tools.
    mockCreate.mockResolvedValue(toolCompletion("select_clinic", { code: "LOTUS" }));
    const { reply } = await handleIncoming("+1agent2", "loop forever");
    expect(reply).toMatch(/having trouble/i);
    expect(mockCreate).toHaveBeenCalledTimes(6); // MAX_ITERATIONS
  });

  it("falls back when the completion has no message", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{}] });
    const { reply } = await handleIncoming("+1agent3", "hmm");
    expect(reply).toMatch(/didn't catch that/i);
  });

  it("falls back when the model returns empty text", async () => {
    mockCreate.mockResolvedValueOnce(textCompletion("   "));
    const { reply } = await handleIncoming("+1agent4", "hmm");
    expect(reply).toMatch(/rephrase/i);
  });

  it("answers a bare greeting from the template with zero LLM calls", async () => {
    const { reply, metrics } = await handleIncoming("+1agent5", "hi");
    expect(metrics.llmCalls).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(reply).toMatch(/which clinic/i); // multi-clinic welcome
  });

  it("degrades gracefully (no throw) when the OpenAI call fails", async () => {
    mockCreate.mockRejectedValue(new Error("503 upstream error"));
    const phone = "+1agent6";
    // Must resolve with a fallback, never reject — a dropped reply is the worst case.
    const { reply } = await handleIncoming(phone, "book me an appointment");
    expect(reply).toMatch(/trouble|try again/i);
    // The fallback is persisted so the conversation stays consistent.
    const last = db
      .prepare(`SELECT content FROM conversations WHERE phone = ? AND role='assistant' ORDER BY id DESC LIMIT 1`)
      .get(phone) as any;
    expect(last.content).toMatch(/trouble|try again/i);
  });
});
