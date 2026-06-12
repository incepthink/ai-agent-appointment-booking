import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendText, splitReply } from "../../src/whatsapp";

function ok() {
  return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.1" }] }), text: async () => "" };
}
function fail(status: number) {
  return { ok: false, status, json: async () => ({}), text: async () => "error body" };
}

describe("whatsapp sendText resilience", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends once on success", async () => {
    fetchMock.mockResolvedValue(ok());
    await sendText("+1", "hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx and succeeds", async () => {
    fetchMock.mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok());
    await sendText("+1", "hello");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 and gives up after MAX attempts", async () => {
    fetchMock.mockResolvedValue(fail(429));
    await sendText("+1", "hello");
    expect(fetchMock).toHaveBeenCalledTimes(3); // MAX_SEND_ATTEMPTS
  });

  it("does NOT retry a 4xx client error (it won't self-heal)", async () => {
    fetchMock.mockResolvedValue(fail(400));
    await sendText("+1", "hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a network-level throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(ok());
    await sendText("+1", "hello");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("splitReply", () => {
  it("keeps the intro whole and ships the slot list + question as one bubble", () => {
    // The exact regression: the only "." + space is in "Dr.", which used to
    // split "Dr. Meera" across two bubbles.
    const reply = [
      "I have the following available slots for a pregnancy test with Dr. Meera Joshi on Friday, June 12:",
      "",
      "- 3:30 PM",
      "- 4:00 PM",
      "- 4:30 PM",
      "",
      "Which time would you prefer?",
    ].join("\n");

    const [head, rest] = splitReply(reply);
    expect(splitReply(reply)).toHaveLength(2);
    expect(head).toBe(
      "I have the following available slots for a pregnancy test with Dr. Meera Joshi on Friday, June 12:",
    );
    expect(rest.startsWith("- 3:30 PM")).toBe(true);
    expect(rest.endsWith("Which time would you prefer?")).toBe(true);
  });

  it("peels a trailing question without breaking at an abbreviation", () => {
    expect(splitReply("Your appointment is with Dr. Mehta. Shall I confirm?")).toEqual([
      "Your appointment is with Dr. Mehta.",
      "Shall I confirm?",
    ]);
  });

  it("does not split at a single-letter initial", () => {
    expect(splitReply("That's A. Kumar. Shall I book?")).toEqual([
      "That's A. Kumar.",
      "Shall I book?",
    ]);
  });

  it("leaves a plain statement (no question, no list) as one bubble", () => {
    expect(splitReply("You're all set.")).toEqual(["You're all set."]);
  });

  it("leaves a single bare question as one bubble", () => {
    expect(splitReply("What's your name?")).toEqual(["What's your name?"]);
  });

  it("leaves a list with no intro above it as one bubble", () => {
    const reply = ["- 3:30 PM", "- 4:00 PM", "Which time would you prefer?"].join("\n");
    expect(splitReply(reply)).toEqual([reply]);
  });

  it("splits cleanly after currency but not inside a decimal time", () => {
    expect(splitReply("It's ₹800. Shall I book?")).toEqual(["It's ₹800.", "Shall I book?"]);
    expect(splitReply("Is the slot at 8.30 PM ok?")).toEqual(["Is the slot at 8.30 PM ok?"]);
  });
});
