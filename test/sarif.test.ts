import { describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Ajv } from "ajv";
import { fromFile } from "../src/connect.js";
import { runRules } from "../src/rules/index.js";
import { buildReport } from "../src/report.js";
import { formatSarif } from "../src/sarif.js";
import { main } from "../src/main.js";
import { vi } from "vitest";

describe("sarif", () => {
  it("has one result per finding and one descriptor per rule", async () => {
    const snap = await fromFile("test/fixtures/bad.json");
    const report = buildReport(snap, runRules(snap), "0.1.0");
    const s = JSON.parse(formatSarif(report, { uri: "./test/fixtures/bad.json" }));
    expect(s.version).toBe("2.1.0");
    const run = s.runs[0];
    expect(run.results).toHaveLength(report.findings.length);
    expect(new Set(run.tool.driver.rules.map((r: any) => r.id)).size).toBe(run.tool.driver.rules.length);
    for (const res of run.results) {
      expect(run.tool.driver.rules[res.ruleIndex].id).toBe(res.ruleId);
      expect(["error", "warning", "note"]).toContain(res.level);
      expect(res.locations[0].physicalLocation.artifactLocation.uri).toBe("test/fixtures/bad.json");
    }
  });

  it("matches the core SARIF shape", async () => {
    const snap = await fromFile("test/fixtures/bad.json");
    const s = JSON.parse(formatSarif(buildReport(snap, runRules(snap), "0.1.0")));
    const ajv = new Ajv({ strict: false });
    const ok = ajv.validate({
      type: "object", required: ["version", "runs"],
      properties: { runs: { type: "array", items: { type: "object", required: ["tool", "results"],
        properties: { results: { type: "array", items: { type: "object", required: ["message", "ruleId"],
          properties: { message: { type: "object", required: ["text"] } } } } } } } },
    }, s);
    expect(ajv.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it("is written by --sarif", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const out = join(mkdtempSync(join(tmpdir(), "mcpmedic-")), "r.sarif");
    await main(["check", "--file", "test/fixtures/bad.json", "--sarif", out]);
    expect(JSON.parse(readFileSync(out, "utf8")).runs[0].tool.driver.name).toBe("mcpmedic");
    vi.restoreAllMocks();
  });
});
