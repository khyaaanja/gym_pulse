import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
import { copyText } from "@/components/app/copy-button";

describe("copyText", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("falls back to a prompt when navigator.clipboard is missing (plain-HTTP LAN)", async () => {
    const prompt = vi.fn();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { prompt });
    await expect(copyText("https://invite/abc", "Link copied")).resolves.toBe(false);
    expect(prompt).toHaveBeenCalledWith("Copy this:", "https://invite/abc");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("copies and toasts when the clipboard works", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("abc", "Link copied")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
    expect(toast.success).toHaveBeenCalledWith("Link copied");
  });
});
