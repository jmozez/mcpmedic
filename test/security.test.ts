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
