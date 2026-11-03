import { printable } from "./sanitize.js";
import type { Provider } from "./providers.js";
import type { ToolDefinition } from "./types.js";
import { runEval, type EvalResult, type EvalSuite } from "./eval.js";
import { runRules } from "./rules/index.js";

export interface Suggestion {
  tool: string;
  before: string;
  after: string;
  /** Accuracy before and after this change, 0 to 1. */
  from: number;
  to: number;
}

export interface FixResult {
  model: string;
  rewriter: string;
  baseline: EvalResult;
  final: EvalResult;
  kept: Suggestion[];
  /** Rewrites that were tried but did not raise the score. */
  dropped: Array<Suggestion & { reason: string }>;
  tools: ToolDefinition[];
}

export interface FixOptions {
  repeat?: number;
  /** At most this many tools are rewritten. */
  maxTools?: number;
  /** Called as work progresses, for a progress line. */
  onStep?: (msg: string) => void;
}

const SYSTEM = `You improve descriptions of MCP tools so that AI models pick the right tool.
Write one description for the tool you are given. Say what it does, when to use it, when not to use it
(name the other tool to use instead, if there is one), and what it returns. Use plain language, at most 60 words.
Do not invent features the schema does not support. Reply with the description only, no quotes or headings.`;

const DESC_RULES = new Set(["missing-description", "short-description", "vague-description", "description-restates-name"]);

/** Tools to try first: those in failing cases (expected or picked), then those with weak descriptions. */
export function candidates(tools: ToolDefinition[], base: EvalResult): string[] {
  const names = new Set(tools.map((t) => t.name));
  const score = new Map<string, number>();
  const bump = (n: string | null | undefined, by: number) => { if (n && names.has(n)) score.set(n, (score.get(n) ?? 0) + by); };
  for (const c of base.cases) {
    const wrong = c.runs.length - c.correct;
    if (!wrong) continue;
    for (const e of c.expect) bump(e, wrong * 2);
    for (const r of c.runs) if (!r.correct) bump(r.tool, 1);
  }
  for (const f of runRules({ tools })) if (f.tool && DESC_RULES.has(f.rule)) bump(f.tool, 1);
  return [...score].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

function brief(tools: ToolDefinition[], name: string, base: EvalResult): string {
  const t = tools.find((x) => x.name === name)!;
  const should = base.cases.filter((c) => c.expect.includes(name)).map((c) => `- ${c.prompt}`);
  const shouldNot = base.cases.filter((c) => !c.expect.includes(name) && c.runs.some((r) => r.tool === name)).map((c) => `- ${c.prompt} (use ${c.expect[0] ?? "no tool"})`);
  const others = tools.filter((x) => x.name !== name).map((x) => `- ${x.name}: ${x.description ?? "(no description)"}`);
  return [
    `Tool: ${name}`,
    `Current description: ${t.description ?? "(none)"}`,
    `Input schema: ${JSON.stringify(t.inputSchema ?? {})}`,
    "",
    `Prompts that should use it:\n${should.join("\n") || "- (none given)"}`,
    "",
    `Prompts that should not use it:\n${shouldNot.join("\n") || "- (none seen)"}`,
    "",
    `Other tools on the server:\n${others.join("\n") || "- (none)"}`,
  ].join("\n");
}

const clean = (s: string) => s.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim();
const withDesc = (tools: ToolDefinition[], name: string, d: string) => tools.map((t) => (t.name === name ? { ...t, description: d } : t));

/**
 * Rewrites one weak description at a time and keeps a rewrite only if eval accuracy goes up.
 * The judge model and the rewriting model can differ.
 */
export async function runFix(judge: Provider, rewriter: Provider, tools: ToolDefinition[], suite: EvalSuite, o: FixOptions = {}): Promise<FixResult> {
  const repeat = o.repeat ?? 3;
  const step = o.onStep ?? (() => {});
  step("Running the baseline eval");
  const baseline = await runEval(judge, tools, suite, { repeat });
  let best = baseline;
  let current = tools;
  const kept: Suggestion[] = [];
  const dropped: FixResult["dropped"] = [];
  for (const name of candidates(tools, baseline).slice(0, o.maxTools ?? 10)) {
    if (best.summary.accuracy >= 1) break;
    const before = current.find((t) => t.name === name)?.description ?? "";
    step(`Rewriting ${name}`);
    let after: string;
    try { after = clean(await rewriter.complete(SYSTEM, brief(current, name, best))); }
    catch (e) { dropped.push({ tool: name, before, after: "", from: best.summary.accuracy, to: best.summary.accuracy, reason: (e as Error).message }); continue; }
    if (!after || after === before) { dropped.push({ tool: name, before, after, from: best.summary.accuracy, to: best.summary.accuracy, reason: "no new description" }); continue; }
    const trial = withDesc(current, name, after);
    step(`Testing the new ${name} description`);
    const r = await runEval(judge, trial, suite, { repeat });
    const s = { tool: name, before, after, from: best.summary.accuracy, to: r.summary.accuracy };
    if (r.summary.accuracy > best.summary.accuracy && r.summary.errors === 0) { kept.push(s); current = trial; best = r; }
    else dropped.push({ ...s, reason: r.summary.errors ? "some eval runs failed" : "accuracy did not go up" });
  }
  return { model: judge.id, rewriter: rewriter.id, baseline, final: best, kept, dropped, tools: current };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function formatFix(r: FixResult): string {
  return printable(formatFixRaw(r));
}

function formatFixRaw(r: FixResult): string {
  const lines = [
    `mcpmedic fix: judged by ${r.model}, rewritten by ${r.rewriter}`,
    `Accuracy ${pct(r.baseline.summary.accuracy)} -> ${pct(r.final.summary.accuracy)}, consistency ${pct(r.baseline.summary.consistency)} -> ${pct(r.final.summary.consistency)}`,
    "",
  ];
  if (!r.kept.length) lines.push("No rewrite raised the score, so nothing changed.");
  for (const k of r.kept) {
    lines.push(`  ${k.tool}  (${pct(k.from)} -> ${pct(k.to)})`, `    - ${k.before || "(no description)"}`, `    + ${k.after}`, "");
  }
  if (r.dropped.length) lines.push(`Tried and dropped: ${r.dropped.map((d) => `${d.tool} (${d.reason})`).join(", ")}`);
  lines.push("", "Check each change before you use it: evals can over-fit to the prompts in your cases file.");
  return lines.join("\n");
}

/** Puts new descriptions into a saved tools/list file, keeping its shape ({ tools } or a bare array). */
export function patchToolsFile(text: string, kept: Suggestion[]): string {
  const data = JSON.parse(text);
  const list: ToolDefinition[] = Array.isArray(data) ? data : data?.tools ?? data?.result?.tools ?? [];
  for (const k of kept) { const t = list.find((x) => x.name === k.tool); if (t) t.description = k.after; }
  return JSON.stringify(data, null, 2) + "\n";
}
