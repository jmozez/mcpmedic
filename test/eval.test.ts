import { afterEach, describe, expect, it, vi } from "vitest";
import { isCorrect, parseSuite, runEval, formatEval } from "../src/eval.js";
import { main } from "../src/main.js";
import type { Provider } from "../src/providers.js";

afterEach(() => vi.restoreAllMocks());

describe("eval cases", () => {
  it("reads names, lists and none", () => {
    const s = parseSuite("system: hi\ncases:\n  - {prompt: a, expect: x}\n  - {prompt: b, expect: [x, y]}\n  - {prompt: c, expect: none}\n  - {prompt: d, expect: null, args: {k: 1}}\n");
    expect(s.system).toBe("hi");
    expect(s.cases.map((c) => c.expect)).toEqual([["x"], ["x", "y"], [], []]);
    expect(parseSuite("- {prompt: a, expect: x}").cases).toHaveLength(1);
  });

  it("explains bad files", () => {
    expect(() => parseSuite("cases: []")).toThrow(/no cases/);
    expect(() => parseSuite("- {expect: x}")).toThrow(/needs a prompt/);
    expect(() => parseSuite("- {prompt: a}")).toThrow(/needs expect/);
  });

  it("checks arguments without case", () => {
    const c = { prompt: "p", expect: ["w"], args: { city: "Wellington" } };
    expect(isCorrect(c, { tool: "w", args: { city: "wellington", days: 3 } })).toBe(true);
    expect(isCorrect(c, { tool: "w", args: { city: "Auckland" } })).toBe(false);
    expect(isCorrect({ prompt: "p", expect: [] }, { tool: null })).toBe(true);
  });
});

describe("runEval", () => {
  it("measures accuracy, consistency and mix-ups", async () => {
    let n = 0;
    const flaky: Provider = { id: "flaky", choose: async () => ({ tool: n++ % 2 ? "a" : "b" }) };
    const r = await runEval(flaky, [], { cases: [{ prompt: "p", expect: ["a"] }] }, { repeat: 4, concurrency: 1 });
    expect(r.summary.accuracy).toBe(0.5);
    expect(r.summary.consistency).toBe(0);
    expect(r.summary.confusions).toEqual([{ expected: "a", picked: "b", count: 2 }]);
    expect(formatEval(r)).toContain("flaky  2/4");
  });

  it("records provider errors without stopping", async () => {
    const bad: Provider = { id: "bad", choose: async () => { throw new Error("401 bad key"); } };
    const r = await runEval(bad, [], { cases: [{ prompt: "p", expect: ["a"] }] }, { repeat: 2 });
    expect(r.summary.errors).toBe(2);
    expect(formatEval(r)).toContain("error: 401 bad key");
  });
});

describe("eval command", () => {
  const out: string[] = [];
  const capture = () => {
    out.length = 0;
    vi.spyOn(console, "log").mockImplementation((s: unknown) => { out.push(String(s)); });
    vi.spyOn(console, "error").mockImplementation((s: unknown) => { out.push(String(s)); });
  };
  const base = ["eval", "--file", "test/fixtures/eval-tools.json", "--cases", "test/fixtures/cases.yaml", "--model", "mock"];

  it("runs the mock model end to end", async () => {
    capture();
    expect(await main([...base, "--json"])).toBe(0);
    const r = JSON.parse(out.join("\n"));
    expect(r.cases).toHaveLength(4);
    expect(r.summary.consistency).toBe(1);
    // The vague "lookup" description loses to the mock, which is the point of fix mode.
    expect(r.cases[2].correct).toBe(0);
    expect(r.summary.accuracy).toBe(0.75);
  });

  it("fails below --min-accuracy", async () => {
    capture();
    expect(await main([...base, "--min-accuracy", "80"])).toBe(1);
    expect(out.join("\n")).toContain("Accuracy 75%");
  });

  it("rejects bad options", async () => {
    capture();
    expect(await main(["eval", "--file", "x.json"])).toBe(2);
    expect(await main([...base, "--repeat", "0"])).toBe(2);
    expect(await main(["eval", "--file", "test/fixtures/eval-tools.json", "--cases", "test/fixtures/cases.yaml", "--model", "openai:x"])).toBe(2);
  });
});
