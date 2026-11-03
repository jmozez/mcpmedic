import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.js";

let server: ChildProcess;
let url = "";
beforeAll(async () => {
  server = spawn(process.execPath, ["test/fixtures/http-server.mjs"]);
  const [chunk] = await once(server.stdout!, "data");
  url = String(chunk).trim();
});
afterAll(() => { server.kill(); });

describe("http", () => {
  it("checks a Streamable HTTP server with a header", async () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: unknown) => { out.push(String(s)); });
    const code = await main(["check", "--json", "--host", "none", "--url", url, "--header", "Authorization: Bearer letmein"]);
    vi.restoreAllMocks();
    const r = JSON.parse(out.join("\n"));
    expect(r.server.name).toBe("http-fixture");
    expect(code).toBe(0);
    expect(JSON.stringify(r)).not.toContain("letmein");
  }, 30000);

  it("fails with exit 2 without the header", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(main(["check", "--host", "none", "--timeout", "5", "--url", url])).rejects.toThrow();
    vi.restoreAllMocks();
  }, 30000);
});
