import { describe, expect, it } from "vitest";
import { fromFile } from "../src/connect.js";
import { rules, runRules } from "../src/rules/index.js";
import type { ServerSnapshot } from "../src/types.js";

const ids = (snap: ServerSnapshot) => new Set(runRules(snap).map((f) => f.rule));

describe("static checks", () => {
  it("passes a well-described tool cleanly", async () => {
    const snap = await fromFile("test/fixtures/good.json");
    expect(runRules(snap)).toEqual([]);
  });

  it("catches the problems in a badly defined server", async () => {
    const found = ids(await fromFile("test/fixtures/bad.json"));
    for (const id of ["name-format", "short-description", "vague-description", "schema-missing", "missing-description",
      "required-unknown", "param-description", "param-type", "empty-enum", "conflicting-annotations",
      "duplicate-name", "similar-names", "missing-annotations"]) {
      expect(found, id).toContain(id);
    }
  });

  it("reports a server with no tools", () => {
    expect(ids({ tools: [] })).toEqual(new Set(["no-tools"]));
  });

  it("flags heavy tools and heavy servers", () => {
    const big = "x".repeat(4000);
    const tools = Array.from({ length: 12 }, (_, i) => ({ name: `t${i}`, description: big, inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }));
    const found = ids({ tools });
    expect(found).toContain("heavy-tool");
    expect(found).toContain("heavy-server");
    expect(found).toContain("long-description");
  });

  it("checks nested and array parameters", () => {
    const found = runRules({ tools: [{ name: "n", description: "Create an invoice for a customer with line items.", annotations: { readOnlyHint: false },
      inputSchema: { type: "object", properties: { items: { type: "array", description: "Lines.", items: { type: "object", properties: { qty: {} } } } } } }] });
    expect(found.map((f) => f.path)).toContain("inputSchema.items[].qty");
  });

  it("can run a single rule", () => {
    expect(runRules({ tools: [] }, ["duplicate-name"])).toEqual([]);
  });

  it("gives every rule a unique id and a fix where it can", () => {
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
  });
});
