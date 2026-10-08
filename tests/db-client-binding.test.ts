import { describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { loadTestEnv } from "./setup/env";

// Guards against src/db/client.ts discarding the test client from tests/setup/db.ts and silently writing to `public`.
describe("app Prisma client in tests", () => {
  it("is the setup client, bound to the isolated test schema", async () => {
    expect(prisma).toBe(globalThis.__gympulsePrisma);
    const rows = await prisma.$queryRaw<{ s: string }[]>`SELECT current_schema() AS s`;
    expect(rows[0]?.s).toBe(loadTestEnv().schema);
  });
});

describe("isCurrent (dev cache staleness)", async () => {
  const { isCurrent } = await import("@/db/client");
  it("accepts a client that has every model, and rejects one generated before a model was added", () => {
    expect(isCurrent(prisma)).toBe(true);
    const stale = new Proxy(prisma, { get: (t, k) => (k === "lead" ? undefined : Reflect.get(t, k)) });
    expect(isCurrent(stale)).toBe(false);
    expect(isCurrent(undefined)).toBe(false);
  });
});
