import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { snapshot, type Target } from "./connect.js";
import { rules, runRules } from "./rules/index.js";
import { buildReport, formatText } from "./report.js";
import type { Severity } from "./types.js";

const require = createRequire(import.meta.url);
const VERSION: string = require("../package.json").version;

const HELP = `mcpmedic ${VERSION}: check an MCP server's tool definitions.

Usage
  mcpmedic check -- <command> [args...]   start a local (stdio) server and check it
  mcpmedic check --url <url>              check a remote (Streamable HTTP or SSE) server
  mcpmedic check --file <tools.json>      check a saved tools/list result
  mcpmedic rules                          list every check

Options
  --json                 print the report as JSON
  --fail-on <level>      exit with code 1 at this level or above: error (default), warning, info, never
  --rule <id>            run only this check (repeatable)
  --header "Name: value" add an HTTP header (repeatable), for example an Authorization header
  --env KEY=value        set an environment variable for a stdio server (repeatable)
  --timeout <seconds>    give up after this long (default 30)
  -h, --help             show this help
  -v, --version          show the version
`;

const ORDER: Severity[] = ["info", "warning", "error"];

export async function main(argv: string[]): Promise<number> {
  const dash = argv.indexOf("--");
  const own = dash >= 0 ? argv.slice(0, dash) : argv;
  const serverCmd = dash >= 0 ? argv.slice(dash + 1) : [];

  const { values, positionals } = parseArgs({
    args: own,
    allowPositionals: true,
    options: {
      url: { type: "string" },
      file: { type: "string" },
      json: { type: "boolean", default: false },
      "fail-on": { type: "string", default: "error" },
      rule: { type: "string", multiple: true },
      header: { type: "string", multiple: true },
      env: { type: "string", multiple: true },
      timeout: { type: "string", default: "30" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (values.version) { console.log(VERSION); return 0; }
  const cmd = positionals[0];
  if (values.help || !cmd) { console.log(HELP); return values.help ? 0 : 2; }

  if (cmd === "rules") {
    for (const r of rules) console.log(`${r.id.padEnd(24)} ${r.severity.padEnd(8)} ${r.summary}`);
    return 0;
  }
  if (cmd !== "check") { console.error(`Unknown command "${cmd}". Run mcpmedic --help.`); return 2; }

  const failOn = values["fail-on"]!;
  if (![...ORDER, "never"].includes(failOn)) { console.error(`--fail-on must be error, warning, info or never.`); return 2; }

  let target: Target;
  if (values.file) target = { kind: "file", path: values.file };
  else if (values.url) {
    const headers: Record<string, string> = {};
    for (const h of values.header ?? []) {
      const i = h.indexOf(":");
      if (i < 1) { console.error(`Header "${h}" should look like "Name: value".`); return 2; }
      headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
    }
    target = { kind: "http", url: values.url, headers };
  } else if (serverCmd.length) {
    const env: Record<string, string> = {};
    for (const e of values.env ?? []) {
      const i = e.indexOf("=");
      if (i < 1) { console.error(`--env "${e}" should look like KEY=value.`); return 2; }
      env[e.slice(0, i)] = e.slice(i + 1);
    }
    target = { kind: "stdio", command: serverCmd[0], args: serverCmd.slice(1), env };
  } else { console.error("Tell mcpmedic what to check: -- <command>, --url or --file."); return 2; }

  const snap = await snapshot(target, Number(values.timeout) * 1000);
  const report = buildReport(snap, runRules(snap, values.rule), VERSION);
  console.log(values.json ? JSON.stringify(report, null, 2) : formatText(report, process.stdout.isTTY));

  if (failOn === "never") return 0;
  const min = ORDER.indexOf(failOn as Severity);
  return report.findings.some((f) => ORDER.indexOf(f.severity) >= min) ? 1 : 0;
}
