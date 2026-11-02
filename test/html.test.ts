import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/main.js";
import { vi } from "vitest";

describe("html report and badge", () => {
  it("writes a safe HTML page and a badge", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "mcpmedic-"));
    await main(["check", "--file", "test/fixtures/bad.json", "--fail-on", "never", "--html", join(dir, "r.html"), "--badge", join(dir, "b.json")]);
    const html = readFileSync(join(dir, "r.html"), "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("duplicate-name");
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("do stuff!");
    const badge = JSON.parse(readFileSync(join(dir, "b.json"), "utf8"));
    expect(badge).toMatchObject({ schemaVersion: 1, label: "mcpmedic", color: "red" });
    vi.restoreAllMocks();
  });

  it("escapes tool names", async () => {
    const { formatHtml } = await import("../src/html.js");
    const html = formatHtml({ tool: "mcpmedic", version: "t", server: { name: "<b>x</b>" }, summary: { tools: 0, tokens: 0, errors: 0, warnings: 0, infos: 0, score: 100 }, tokensByTool: [], findings: [{ rule: "r", severity: "error", tool: "<img src=x onerror=alert(1)>", message: "m" }] });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>x</b>");
  });
});
