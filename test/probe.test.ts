import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.js";
import { sampleArguments } from "../src/sample.js";

afterEach(() => vi.restoreAllMocks());

describe("sample input", () => {
  it("fills required properties from the schema", () => {
    const args = sampleArguments({
      type: "object",
      required: ["a", "b", "c", "d", "e", "f"],
      properties: {
        a: { type: "string", format: "email" },
        b: { type: "integer", minimum: 5 },
        c: { enum: ["x", "y"] },
        d: { type: "array", minItems: 1, items: { type: "boolean" } },
        e: { type: "object", required: ["g"], properties: { g: { type: "string", minLength: 6 } } },
        f: { type: ["null", "number"], maximum: 0 },
        skip: { type: "string" },
      },
    });
    expect(args).toEqual({ a: "someone@example.com", b: 5, c: "x", d: [false], e: { g: "testxx" }, f: 0 });
  });

  it("prefers defaults and examples", () => {
    expect(sampleArguments({ type: "object", required: ["n", "s"], properties: { n: { type: "number", default: 7 }, s: { type: "string", examples: ["hi"] } } }))
      .toEqual({ n: 7, s: "hi" });
  });
});

describe("probe", () => {
  it("finds each probe problem on the fixture server", async () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: unknown) => { out.push(String(s)); });
    const code = await main(["check", "--probe", "--json", "--fail-on", "never", "--", process.execPath, "test/fixtures/probe-server.mjs"]);
    expect(code).toBe(0);
    const report = JSON.parse(out.join("\n"));
    const hits = (rule: string) => report.findings.filter((f: { rule: string }) => f.rule === rule).map((f: { tool?: string }) => f.tool);
    expect(hits("probe-accepts-invalid")).toEqual(["sloppy", "big", "nostruct"]);
    expect(hits("probe-unhelpful-error")).toEqual(["terse"]);
    expect(hits("probe-crash")).toEqual(["crashy"]);
    expect(hits("probe-large-response")).toEqual(["big"]);
    expect(hits("probe-output-schema")).toEqual(["nostruct"]);
    expect(hits("probe-skipped")).toHaveLength(1);
    expect(hits("probe-unhelpful-error")).not.toContain("lookup");
    expect(JSON.stringify(report)).not.toContain("destructive tool");
  }, 20000);

  it("refuses to probe a saved file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["check", "--probe", "--file", "test/fixtures/good.json"])).toBe(2);
  });
});
