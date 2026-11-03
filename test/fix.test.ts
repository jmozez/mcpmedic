import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { patchToolsFile, runFix } from "../src/fix.js";
import { mock, type Provider } from "../src/providers.js";
import { loadSuite } from "../src/eval.js";
import { fromFile } from "../src/connect.js";
import { main } from "../src/main.js";

afterEach(() => vi.restoreAllMocks());

describe("fix", () => {
  it("keeps a rewrite that raises accuracy", async () => {
    const { tools } = await fromFile("test/fixtures/eval-tools.json");
    const r = await runFix(mock(), mock(), tools, loadSuite("test/fixtures/cases.yaml"), { repeat: 2 });
    expect(r.baseline.summary.accuracy).toBe(0.75);
    expect(r.final.summary.accuracy).toBe(1);
    expect(r.kept.map((k) => k.tool)).toEqual(["lookup"]);
    expect(r.kept[0].before).toBe("Looks things up.");
    expect(r.kept[0].after).toContain("phone number");
  });

  it("drops a rewrite that does not help", async () => {
    const { tools } = await fromFile("test/fixtures/eval-tools.json");
    const useless: Provider = { ...mock(), id: "useless", complete: async () => "Does a thing." };
    const r = await runFix(mock(), useless, tools, loadSuite("test/fixtures/cases.yaml"), { repeat: 1 });
    expect(r.kept).toEqual([]);
    expect(r.dropped[0]).toMatchObject({ tool: "lookup", reason: "accuracy did not go up" });
    expect(r.tools.find((t) => t.name === "lookup")?.description).toBe("Looks things up.");
  });

  it("patches a tools file and keeps its shape", () => {
    const out = JSON.parse(patchToolsFile('[{"name":"a","description":"x"}]', [{ tool: "a", before: "x", after: "y", from: 0, to: 1 }]));
    expect(out).toEqual([{ name: "a", description: "y" }]);
  });

  it("writes suggestions and a patched copy from the CLI", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "mcpmedic-"));
    const code = await main(["fix", "--file", "test/fixtures/eval-tools.json", "--cases", "test/fixtures/cases.yaml", "--model", "mock",
      "--out", join(dir, "s.json"), "--write", join(dir, "tools.json"), "--min-accuracy", "100"]);
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "s.json"), "utf8")).suggestions[0].tool).toBe("lookup");
    const patched = JSON.parse(readFileSync(join(dir, "tools.json"), "utf8"));
    expect(patched.tools.find((t: any) => t.name === "lookup").description).toContain("Use lookup");
  });

  it("needs --file for --write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["fix", "--url", "http://x", "--cases", "test/fixtures/cases.yaml", "--model", "mock", "--write", "t.json"])).toBe(2);
  });
});
