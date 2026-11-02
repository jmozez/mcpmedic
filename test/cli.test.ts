import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.js";
import { score } from "../src/report.js";

function capture() {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((s: unknown) => { out.push(String(s)); });
  vi.spyOn(console, "error").mockImplementation((s: unknown) => { out.push(String(s)); });
  return out;
}
afterEach(() => vi.restoreAllMocks());

describe("cli", () => {
  it("exits 0 for a clean file", async () => {
    const out = capture();
    expect(await main(["check", "--file", "test/fixtures/good.json"])).toBe(0);
    expect(out.join("\n")).toContain("Score 100/100");
  });

  it("exits 1 when errors are found", async () => {
    capture();
    expect(await main(["check", "--file", "test/fixtures/bad.json"])).toBe(1);
  });

  it("respects --fail-on never", async () => {
    capture();
    expect(await main(["check", "--file", "test/fixtures/bad.json", "--fail-on", "never"])).toBe(0);
  });

  it("prints valid JSON with --json", async () => {
    const out = capture();
    await main(["check", "--file", "test/fixtures/good.json", "--json"]);
    const r = JSON.parse(out.join("\n"));
    expect(r.summary.tools).toBe(1);
    expect(r.summary.tokens).toBeGreaterThan(0);
  });

  it("returns 2 for usage mistakes", async () => {
    capture();
    expect(await main(["check"])).toBe(2);
    expect(await main(["nope"])).toBe(2);
    expect(await main(["check", "--file", "x", "--fail-on", "maybe"])).toBe(2);
  });

  it("checks a live stdio server and follows pagination", async () => {
    const out = capture();
    const code = await main(["check", "--json", "--", process.execPath, "test/fixtures/server.mjs"]);
    const r = JSON.parse(out.join("\n"));
    expect(r.server.name).toBe("fixture-server");
    expect(r.summary.tools).toBe(2);
    expect(r.findings.some((f: { tool: string; rule: string }) => f.tool === "wipe" && f.rule === "short-description")).toBe(true);
    expect(code).toBe(0);
  }, 20000);

  it("scores lower as findings grow", () => {
    expect(score([], 3)).toBe(100);
    expect(score([{ rule: "a", severity: "error", message: "" }], 1)).toBe(50);
  });
});
