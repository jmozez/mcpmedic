import { describe, expect, it } from "vitest";
import { fromFile } from "../src/connect.js";
import { hostRules, loadHostPack } from "../src/hosts.js";
import { runRules } from "../src/rules/index.js";
import { buildReport } from "../src/report.js";

const pack = loadHostPack();

describe("host rule pack", () => {
  it("loads, and every rule has a source, a quote and a check date", () => {
    expect(pack.rules.length).toBeGreaterThanOrEqual(15);
    for (const r of pack.rules) {
      expect(r.source, r.id).toMatch(/^https:\/\//);
      expect(r.quote?.length, r.id).toBeGreaterThan(10);
      expect(String(r.checked), r.id).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
    expect(new Set(pack.rules.map((r) => r.id)).size).toBe(pack.rules.length);
  });

  it("flags each host problem in the fixture", async () => {
    const snap = await fromFile("test/fixtures/hosts.json");
    const found = runRules(snap, undefined, hostRules(pack)).filter((f) => f.host);
    const tools = (id: string) => found.filter((f) => f.rule === id).map((f) => f.tool);
    expect(tools("claude-api-tool-name")).toEqual(["files.read"]);
    expect(tools("gemini-api-tool-name")).toEqual(["files.read"]);
    expect(tools("claude-code-root-combinator")).toEqual(["pick"]);
    expect(tools("claude-code-property-names")).toEqual(["weird_params"]);
    expect(tools("claude-code-schema-valid")).toEqual(["bad_schema"]);
    expect(tools("claude-code-full-name")).toEqual(["x".repeat(120)]);
    expect(tools("codex-read-only-hint")).toEqual(["write_note"]);
    expect(tools("codex-instructions-length")).toHaveLength(1);
    expect(found.every((f) => f.source && f.message.startsWith("["))).toBe(true);
  });

  it("can be limited to one host", async () => {
    const snap = await fromFile("test/fixtures/hosts.json");
    const found = runRules(snap, undefined, hostRules(pack, ["codex"])).filter((f) => f.host);
    expect(new Set(found.map((f) => f.host))).toEqual(new Set(["codex"]));
  });

  it("checks probe results against output and time limits", () => {
    const snap = {
      tools: [{ name: "big", description: "x", inputSchema: { type: "object" } }],
      startupMs: 12000,
      probes: [{ tool: "big", valid: { ok: true, ms: 61000, text: "", tokens: 26000 } }],
    };
    const ids = runRules(snap, undefined, hostRules(pack)).filter((f) => f.host).map((f) => f.rule);
    expect(ids).toEqual(expect.arrayContaining(["claude-code-output-warning", "claude-code-output-limit", "codex-tool-timeout", "codex-startup-timeout"]));
  });

  it("does not let host rules change the score", async () => {
    const snap = await fromFile("test/fixtures/good.json");
    const plain = buildReport(snap, runRules(snap), "t").summary.score;
    const withHosts = buildReport(snap, runRules(snap, undefined, hostRules(pack)), "t").summary.score;
    expect(withHosts).toBe(plain);
  });
});
