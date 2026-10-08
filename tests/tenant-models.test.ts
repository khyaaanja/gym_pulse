import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TENANT_MODELS } from "@/db/tenant";

/** tenantDb only scopes the models it lists; a new model with a gymId column must be added there too. */
describe("tenant model list", () => {
  it("matches every model with a non-null gymId in the schema", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const scoped = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].filter(([, , body]) => /^\s+gymId\s+String(?!\?)\b/m.test(body!)).map(([, name]) => name).sort();
    expect([...TENANT_MODELS].sort()).toEqual(scoped);
  });
});
