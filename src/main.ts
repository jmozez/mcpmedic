import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { openSession, snapshot, type Target } from "./connect.js";
import { probe } from "./probe.js";
import { hostRules, loadHostPack } from "./hosts.js";
import { rules, runRules } from "./rules/index.js";
import { buildReport, formatText } from "./report.js";
import { badgeJson, formatHtml } from "./html.js";
import { formatSarif } from "./sarif.js";
import { writeFileSync } from "node:fs";
import type { Severity } from "./types.js";
import { makeProvider } from "./providers.js";
import { formatEval, loadSuite, runEval } from "./eval.js";
import { formatFix, patchToolsFile, runFix } from "./fix.js";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const VERSION: string = require("../package.json").version;

const HELP = `mcpmedic ${VERSION}: check an MCP server's tool definitions.

Usage
  mcpmedic check -- <command> [args...]   start a local (stdio) server and check it
  mcpmedic check --url <url>              check a remote (Streamable HTTP or SSE) server
  mcpmedic check --file <tools.json>      check a saved tools/list result
  mcpmedic eval --cases <file> --model <provider:model> [target]
                                          check that a model picks the right tool for each prompt
  mcpmedic fix --cases <file> --model <provider:model> [target]
                                          rewrite weak descriptions, keeping only those that raise eval accuracy
  mcpmedic rules                          list every check
  mcpmedic hosts                          list the host rules and their sources

Options
  --probe                call each read-only tool with sample input and check the answers
  --probe-all            also call tools not marked read-only (only use on a test server)
  --probe-tool <name>    probe only this tool (repeatable)
  --host <id>            check only this host's rules (repeatable), or "none" to skip them
  --server-name <name>   the name users give the server in their config (for prefixed tool names)
  --json                 print the report as JSON
  --html <file>          also write the report as a single HTML page
  --badge <file>         also write a shields.io endpoint badge with the score
  --sarif <file>         also write SARIF 2.1.0 for GitHub code scanning
  --fail-on <level>      exit with code 1 at this level or above: error (default), warning, info, never
  --rule <id>            run only this check (repeatable)
  --header "Name: value" add an HTTP header (repeatable), for example an Authorization header
  --env KEY=value        set an environment variable for a stdio server (repeatable)
  --inherit-env          pass all of mcpmedic's environment to a stdio server (default: a minimal set, like MCP hosts)
  --timeout <seconds>    give up after this long (default 30)

Eval options
  --cases <file>         YAML or JSON list of { prompt, expect } cases
  --model <spec>         openai:<model>, anthropic:<model>, openrouter:<model>, ollama:<model>,
                         compatible:<model> (uses MCPMEDIC_BASE_URL) or mock. Keys come from env vars.
  --repeat <n>           run each case this many times to measure consistency (default 3)
  --min-accuracy <pct>   exit with code 1 below this accuracy (default 0, never fail)

Fix options (and the eval options above)
  --rewrite-model <spec> model that writes the new descriptions (default: the --model)
  --max-tools <n>        rewrite at most this many tools (default 10)
  --out <file>           write the kept suggestions as JSON
  --write <file>         with --file, write a copy of the tools file with the new descriptions

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
      html: { type: "string" },
      badge: { type: "string" },
      sarif: { type: "string" },
      host: { type: "string", multiple: true },
      "server-name": { type: "string" },
      probe: { type: "boolean", default: false },
      "probe-all": { type: "boolean", default: false },
      "probe-tool": { type: "string", multiple: true },
      "fail-on": { type: "string", default: "error" },
      rule: { type: "string", multiple: true },
      header: { type: "string", multiple: true },
      env: { type: "string", multiple: true },
      "inherit-env": { type: "boolean" },
      timeout: { type: "string", default: "30" },
      cases: { type: "string" },
      model: { type: "string" },
      repeat: { type: "string", default: "3" },
      "min-accuracy": { type: "string", default: "0" },
      "rewrite-model": { type: "string" },
      "max-tools": { type: "string", default: "10" },
      out: { type: "string" },
      write: { type: "string" },
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
  if (cmd === "hosts") {
    const pack = loadHostPack();
    console.log(`Host rule pack ${pack.version}\n`);
    for (const [id, name] of Object.entries(pack.hosts)) {
      console.log(`${name} (--host ${id})`);
      for (const r of pack.rules.filter((x) => x.host === id)) {
        console.log(`  ${r.id.padEnd(28)} ${r.severity.padEnd(8)} ${r.summary}`);
        console.log(`  ${" ".repeat(28)} ${r.source}`);
      }
      console.log("");
    }
    return 0;
  }
  if (!["check", "eval", "fix"].includes(cmd)) { console.error(`Unknown command "${cmd}". Run mcpmedic --help.`); return 2; }

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
    target = { kind: "stdio", command: serverCmd[0], args: serverCmd.slice(1), env, inheritEnv: values["inherit-env"] === true };
  } else { console.error("Tell mcpmedic what to check: -- <command>, --url or --file."); return 2; }

  const timeoutMs = Number(values.timeout) * 1000;
  if (cmd === "eval" || cmd === "fix") {
    if (!values.cases || !values.model) { console.error(cmd + " needs --cases <file> and --model <provider:model>."); return 2; }
    const repeat = Number(values.repeat);
    const min = Number(values["min-accuracy"]);
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 50) { console.error("--repeat must be a whole number from 1 to 50."); return 2; }
    if (!(min >= 0 && min <= 100)) { console.error("--min-accuracy must be a percentage from 0 to 100."); return 2; }
    let provider, rewriter, suite;
    try {
      provider = makeProvider(values.model, { timeoutMs });
      rewriter = values["rewrite-model"] ? makeProvider(values["rewrite-model"], { timeoutMs, temperature: 0.3 }) : provider;
      suite = loadSuite(values.cases);
    } catch (e) { console.error((e as Error).message); return 2; }
    if (values.write && !values.file) { console.error("--write needs --file, so there is a tools file to copy."); return 2; }
    const snap = await snapshot(target, timeoutMs);
    if (cmd === "fix") {
      const maxTools = Number(values["max-tools"]);
      const quiet = values.json || !process.stderr.isTTY;
      const r = await runFix(provider, rewriter, snap.tools, suite, { repeat, maxTools, onStep: quiet ? undefined : (m) => process.stderr.write(`  ${m}...\n`) });
      if (r.baseline.summary.errors === r.baseline.summary.runs) { console.error("Every eval run failed. Check the model name and key."); return 2; }
      if (values.out) writeFileSync(values.out, JSON.stringify({ model: r.model, rewriter: r.rewriter, from: r.baseline.summary.accuracy, to: r.final.summary.accuracy, suggestions: r.kept }, null, 2) + "\n");
      if (values.write && values.file) writeFileSync(values.write, patchToolsFile(readFileSync(values.file, "utf8"), r.kept));
      console.log(values.json ? JSON.stringify({ ...r, tools: undefined }, null, 2) : formatFix(r));
      return r.final.summary.accuracy * 100 < min ? 1 : 0;
    }
    const result = await runEval(provider, snap.tools, suite, { repeat });
    console.log(values.json ? JSON.stringify(result, null, 2) : formatEval(result));
    if (result.summary.errors === result.summary.runs) return 2;
    return result.summary.accuracy * 100 < min ? 1 : 0;
  }
  const probing = values.probe || values["probe-all"] || Boolean(values["probe-tool"]?.length);
  let snap;
  if (probing) {
    if (target.kind === "file") { console.error("Probes need a live server: use -- <command> or --url, not --file."); return 2; }
    const session = await openSession(target, timeoutMs);
    try {
      snap = { ...session.snapshot };
      snap.probes = await probe(session.client, snap, { all: values["probe-all"], only: values["probe-tool"], timeoutMs });
    } finally {
      await session.close();
    }
  } else {
    snap = await snapshot(target, timeoutMs);
  }
  const pack = loadHostPack();
  const hostIds = values.host ?? [];
  for (const h of hostIds) {
    if (h !== "none" && !pack.hosts[h]) { console.error(`Unknown host "${h}". Run mcpmedic hosts to see them.`); return 2; }
  }
  const extra = hostIds.includes("none") ? [] : hostRules(pack, hostIds, { serverName: values["server-name"] });
  const report = buildReport(snap, runRules(snap, values.rule, extra), VERSION);
  report.hostPack = extra.length ? pack.version : undefined;
  if (values.html) writeFileSync(values.html, formatHtml(report));
  if (values.sarif) writeFileSync(values.sarif, formatSarif(report, { uri: values.file }));
  if (values.badge) writeFileSync(values.badge, badgeJson(report));
  console.log(values.json ? JSON.stringify(report, null, 2) : formatText(report, process.stdout.isTTY));

  if (failOn === "never") return 0;
  const min = ORDER.indexOf(failOn as Severity);
  return report.findings.some((f) => ORDER.indexOf(f.severity) >= min) ? 1 : 0;
}
