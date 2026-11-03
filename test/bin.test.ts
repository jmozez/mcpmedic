import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Runs the built CLI, so the exit codes and error path in cli.ts are covered. Needs npm run build first.
describe.runIf(existsSync("dist/cli.js"))("bin", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8", timeout: 30000 });
  it("exits 0, 1 and 2 as documented", () => {
    expect(run("check", "--file", "test/fixtures/good.json").status).toBe(0);
    expect(run("check", "--file", "test/fixtures/bad.json").status).toBe(1);
    const missing = run("check", "--file", "missing.json");
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/^mcpmedic: /);
  });
  it("exits 2, not 0, when a stdio server stalls", () => {
    const r = run("check", "--host", "none", "--timeout", "2", "--", process.execPath, "test/fixtures/hostile-server.mjs", "silent");
    expect(r.status).toBe(2);
  });
});
