import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendText } from "../../src/whatsapp";

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
