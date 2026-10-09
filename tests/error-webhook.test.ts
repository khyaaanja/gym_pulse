import { afterEach, describe, expect, it, vi } from "vitest";
import { reportError } from "@/lib/logger";

afterEach(() => {
  delete process.env.ERROR_WEBHOOK_URL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const capture = (status = 200) => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response("ok", { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("error webhook", () => {
  it("sends a body Slack (text) and Discord (content) accept, with secrets redacted", async () => {
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example.test/x";
    const fetchMock = capture();
    await reportError("api.unhandled", { requestId: "req-123", password: "hunter2", err: new Error("boom") });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://hooks.example.test/x");
    const body = JSON.parse(String(init.body));
    expect(body.text).toContain("api.unhandled");
    expect(body.text).toContain("req-123");
    expect(body.content).toBe(body.text);
    expect(body.content.length).toBeLessThanOrEqual(2000);
    expect(body.msg).toBe("api.unhandled");
    expect(body.meta.password).toBe("[redacted]");
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("says so in the logs when the webhook rejects the message, instead of failing silently", async () => {
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example.test/x";
    capture(400);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await reportError("api.unhandled");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("error_webhook.rejected"));
  });

  it("does nothing without a webhook URL", async () => {
    const fetchMock = capture();
    await reportError("api.unhandled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
