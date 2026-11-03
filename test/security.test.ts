import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.js";

const HOSTILE = "test/fixtures/hostile-server.mjs";
function capture() {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((s: unknown) => { out.push(String(s)); });
  vi.spyOn(console, "error").mockImplementation((s: unknown) => { out.push(String(s)); });
  return out;
}
afterEach(() => vi.restoreAllMocks());

describe("hostile servers", () => {
  it("still answers when the server floods stderr", async () => {
    const out = capture();
    const code = await main(["check", "--json", "--host", "none", "--timeout", "10", "--", process.execPath, HOSTILE, "stderr"]);
    expect(JSON.parse(out.join("\n")).summary.tools).toBe(3);
    expect(code).toBe(1);
  }, 30000);

  for (const mode of ["silent", "hang", "garbage"]) {
    it(`fails with a timeout when the server is ${mode}`, async () => {
      // cli.ts turns this rejection into exit code 2.
      await expect(main(["check", "--host", "none", "--timeout", "2", "--", process.execPath, HOSTILE, mode])).rejects.toThrow(/No answer/);
    }, 20000);
  }

  it("reports a hanging tool call as a timeout instead of hanging", async () => {
    const out = capture();
    await main(["check", "--json", "--probe", "--host", "none", "--timeout", "2", "--", process.execPath, HOSTILE, "hangcall"]);
    expect(out.join("\n")).toMatch(/timed out|No answer|within/i);
  }, 30000);
});

describe("output from servers is neutralised", () => {
  it("shows terminal escapes as text in the text report", async () => {
    const out = capture();
    await main(["check", "--host", "none", "--", process.execPath, HOSTILE, "ansi"]);
    const text = out.join("\n");
    expect(text).not.toMatch(/\x1b|\x07|\r/);
    expect(text).toContain("\\u001b[2J");
  }, 20000);

  it("keeps the HTML report free of markup and control characters from the server", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "mcpmedic-"));
    capture();
    await main(["check", "--host", "none", "--html", join(dir, "r.html"), "--sarif", join(dir, "r.sarif"), "--", process.execPath, HOSTILE, "ansi"]);
    const html = readFileSync(join(dir, "r.html"), "utf8");
    expect(html).not.toMatch(/<script|<img|\x1b/);
    expect(() => JSON.parse(readFileSync(join(dir, "r.sarif"), "utf8"))).not.toThrow();
  }, 20000);
});

describe("stdio environment", () => {
  it("does not pass model API keys to the server unless --inherit-env is set", async () => {
    const { openSession } = await import("../src/connect.js");
    const { callOnce } = await import("../src/probe.js");
    process.env.OPENAI_API_KEY = "sk-test-leak-check";
    try {
      for (const [inheritEnv, leaks] of [[false, false], [true, true]] as const) {
        const s = await openSession({ kind: "stdio", command: process.execPath, args: [HOSTILE, "ansi"], env: { EXTRA: "given" }, inheritEnv });
        const r = await callOnce(s.client, "env", {}, 5000);
        await s.close();
        expect(r.text.includes("sk-test-leak-check")).toBe(leaks);
        expect(r.text).toContain("given");
      }
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  }, 30000);
});
