import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { Choice, Provider } from "./providers.js";
import type { ToolDefinition } from "./types.js";

export interface EvalCase {
  prompt: string;
  /** Tool names that count as right. An empty list means the model should not call a tool. */
  expect: string[];
  /** Arguments that must be present with these values (strings compared without case). */
  args?: Record<string, unknown>;
}

export interface EvalSuite {
  system?: string;
  cases: EvalCase[];
}

export interface CaseResult {
  prompt: string;
  expect: string[];
  runs: Array<Choice & { correct: boolean; error?: string }>;
  correct: number;
  /** Every run picked the same tool. */
  consistent: boolean;
  /** The tool picked most often, or null for no tool. */
  usual: string | null;
}

export interface EvalResult {
  model: string;
  repeat: number;
  cases: CaseResult[];
  summary: {
    runs: number;
    errors: number;
    /** Share of all runs that picked a right tool, 0 to 1. */
    accuracy: number;
    /** Share of cases where every run picked the same tool. */
    consistency: number;
    /** Tools that were picked when another was expected: wrong tool to count. */
    confusions: Array<{ expected: string; picked: string; count: number }>;
  };
}

const NONE = new Set(["none", "no tool", "null", "~", ""]);

/** Reads cases from YAML or JSON: either { system, cases: [...] } or a bare list. */
export function parseSuite(text: string, where = "cases file"): EvalSuite {
  const data = parse(text);
  const list = Array.isArray(data) ? data : data?.cases;
  if (!Array.isArray(list) || !list.length) throw new Error(`${where} has no cases. Give a list of { prompt, expect }.`);
  const cases = list.map((c: any, i: number): EvalCase => {
    if (!c || typeof c.prompt !== "string" || !c.prompt.trim()) throw new Error(`Case ${i + 1} in ${where} needs a prompt.`);
    if (!("expect" in c)) throw new Error(`Case ${i + 1} in ${where} needs expect: a tool name, a list of names, or none.`);
    const raw = c.expect === null ? [] : Array.isArray(c.expect) ? c.expect : [c.expect];
    const expect = raw.map(String).filter((x: string) => !NONE.has(x.toLowerCase()));
    return { prompt: c.prompt, expect, ...(c.args && typeof c.args === "object" ? { args: c.args } : {}) };
  });
  return { system: typeof data?.system === "string" ? data.system : undefined, cases };
}

export function loadSuite(path: string): EvalSuite {
  return parseSuite(readFileSync(path, "utf8"), path);
}

function argsMatch(want: Record<string, unknown> | undefined, got: Record<string, unknown> | undefined): boolean {
  if (!want) return true;
  for (const [k, v] of Object.entries(want)) {
    const g = got?.[k];
    if (typeof v === "string" && typeof g === "string") { if (v.toLowerCase() !== g.toLowerCase()) return false; }
    else if (JSON.stringify(v) !== JSON.stringify(g)) return false;
  }
  return true;
}

export function isCorrect(c: EvalCase, choice: Choice): boolean {
  if (!c.expect.length) return choice.tool === null;
  return choice.tool !== null && c.expect.includes(choice.tool) && argsMatch(c.args, choice.args);
}

async function pool<T>(jobs: Array<() => Promise<T>>, size: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); }
  }));
  return out;
}

export interface EvalOptions {
  repeat?: number;
  concurrency?: number;
}

export async function runEval(provider: Provider, tools: ToolDefinition[], suite: EvalSuite, o: EvalOptions = {}): Promise<EvalResult> {
  const repeat = Math.max(1, o.repeat ?? 3);
  const jobs = suite.cases.flatMap((c) => Array.from({ length: repeat }, () => async () => {
    try {
      const choice = await provider.choose({ system: suite.system, prompt: c.prompt, tools });
      return { ...choice, correct: isCorrect(c, choice) };
    } catch (e) {
      return { tool: null, correct: false, error: (e as Error).message };
    }
  }));
  const flat = await pool(jobs, o.concurrency ?? 4);
  const confusion = new Map<string, number>();
  const cases = suite.cases.map((c, i): CaseResult => {
    const runs = flat.slice(i * repeat, (i + 1) * repeat);
    const counts = new Map<string | null, number>();
    for (const r of runs) if (!r.error) counts.set(r.tool, (counts.get(r.tool) ?? 0) + 1);
    let usual: string | null = null;
    let most = 0;
    for (const [t, n] of counts) if (n > most) { usual = t; most = n; }
    for (const r of runs) {
      if (r.correct || r.error) continue;
      const key = `${c.expect[0] ?? "(no tool)"}\u0000${r.tool ?? "(no tool)"}`;
      confusion.set(key, (confusion.get(key) ?? 0) + 1);
    }
    return { prompt: c.prompt, expect: c.expect, runs, correct: runs.filter((r) => r.correct).length, consistent: counts.size === 1 && most === runs.length, usual };
  });
  const total = flat.length;
  return {
    model: provider.id,
    repeat,
    cases,
    summary: {
      runs: total,
      errors: flat.filter((r) => r.error).length,
      accuracy: total ? flat.filter((r) => r.correct).length / total : 0,
      consistency: cases.length ? cases.filter((c) => c.consistent).length / cases.length : 0,
      confusions: [...confusion].map(([k, count]) => { const [expected, picked] = k.split("\u0000"); return { expected, picked, count }; })
        .sort((a, b) => b.count - a.count),
    },
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function formatEval(r: EvalResult): string {
  const s = r.summary;
  const lines = [
    `mcpmedic eval with ${r.model}: ${r.cases.length} cases, ${r.repeat} runs each`,
    `Accuracy ${pct(s.accuracy)}, consistency ${pct(s.consistency)}${s.errors ? `, ${s.errors} runs failed` : ""}`,
    "",
  ];
  for (const c of r.cases) {
    const mark = c.correct === c.runs.length ? "pass" : c.correct === 0 ? "FAIL" : "flaky";
    const want = c.expect.length ? c.expect.join(" or ") : "no tool";
    lines.push(`  ${mark.padEnd(6)} ${c.correct}/${c.runs.length}  ${c.prompt}`);
    if (mark !== "pass") {
      const picked = [...new Set(c.runs.map((x) => x.error ? `error: ${x.error.slice(0, 80)}` : x.tool ?? "no tool"))].join(", ");
      lines.push(`                expected ${want}, got ${picked}`);
    }
  }
  if (s.confusions.length) {
    lines.push("", "Most common mix-ups (expected, then picked):");
    for (const c of s.confusions.slice(0, 5)) lines.push(`  ${c.expected} -> ${c.picked}  (${c.count})`);
    lines.push("", "Tip: make the descriptions of mixed-up tools say when to use each one, and when not to.");
  }
  return lines.join("\n");
}
