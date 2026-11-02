import type { Finding, Rule, ServerSnapshot, ToolDefinition } from "../types.js";
import { toolTokens } from "../tokens.js";
import { probeRules } from "./probe.js";

const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const VAGUE = /^(does|handles|manages|processes|gets|runs|a tool|tool for|utility)\b/i;

type Schema = Record<string, unknown>;

function perTool(fn: (tool: ToolDefinition) => Omit<Finding, "rule" | "severity" | "tool">[]) {
  return (rule: Rule) => (snap: ServerSnapshot): Finding[] =>
    snap.tools.flatMap((t) => fn(t).map((f) => ({ rule: rule.id, severity: rule.severity, tool: t.name, ...f })));
}

function make(id: string, severity: Rule["severity"], summary: string,
  fn: (tool: ToolDefinition) => Omit<Finding, "rule" | "severity" | "tool">[]): Rule {
  const rule: Rule = { id, severity, summary, check: () => [] };
  rule.check = perTool(fn)(rule);
  return rule;
}

function props(schema: Schema | undefined): Record<string, Schema> {
  const p = schema?.properties;
  return p && typeof p === "object" ? (p as Record<string, Schema>) : {};
}

/** Walks nested object properties, yielding a dotted path for each one. */
function* walk(schema: Schema | undefined, prefix = ""): Generator<[string, Schema]> {
  for (const [key, child] of Object.entries(props(schema))) {
    const path = prefix ? `${prefix}.${key}` : key;
    yield [path, child];
    if (child && typeof child === "object") {
      yield* walk(child, path);
      const items = child.items as Schema | undefined;
      if (items && typeof items === "object") yield* walk(items, `${path}[]`);
    }
  }
}

export const rules: Rule[] = [
  {
    id: "no-tools",
    severity: "error",
    summary: "The server lists at least one tool.",
    check: (s) => (s.tools.length === 0
      ? [{ rule: "no-tools", severity: "error", message: "The server returned no tools from tools/list." }]
      : []),
  },
  {
    id: "duplicate-name",
    severity: "error",
    summary: "Tool names are unique.",
    check: (s) => {
      const seen = new Set<string>();
      const out: Finding[] = [];
      for (const t of s.tools) {
        if (seen.has(t.name)) out.push({ rule: "duplicate-name", severity: "error", tool: t.name, message: `More than one tool is called "${t.name}".`, fix: "Give each tool a unique name." });
        seen.add(t.name);
      }
      return out;
    },
  },
  make("name-format", "error", "Tool names use 1 to 64 letters, digits, underscores, dots or hyphens.", (t) =>
    NAME_PATTERN.test(t.name) ? [] : [{
      message: `The name "${t.name}" will be rejected or renamed by some hosts.`,
      fix: "Use only A to Z, 0 to 9, underscore, dot or hyphen, up to 64 characters, for example get_weather.",
    }]),
  make("missing-description", "error", "Every tool has a description.", (t) =>
    t.description && t.description.trim() ? [] : [{
      message: "The tool has no description, so the model has to guess when to use it.",
      fix: "Say what the tool does, when to use it and what it returns, in one or two sentences.",
    }]),
  make("short-description", "warning", "Descriptions are long enough to choose the tool well.", (t) => {
    const d = t.description?.trim() ?? "";
    return d && d.length < 40 ? [{
      message: `The description is only ${d.length} characters long, which rarely tells the model when to pick this tool.`,
      fix: "Add when to use it, what it returns and any limits.",
    }] : [];
  }),
  make("vague-description", "warning", "Descriptions start with what the tool actually does.", (t) =>
    t.description && VAGUE.test(t.description.trim()) ? [{
      message: "The description opens with a vague verb such as \"handles\" or \"manages\".",
      fix: "Start with a specific action and object, for example \"Search open GitHub issues by label\".",
    }] : []),
  make("long-description", "warning", "Descriptions stay under about 1,000 characters.", (t) =>
    (t.description?.length ?? 0) > 1000 ? [{
      message: `The description is ${t.description!.length} characters long and costs context on every request.`,
      fix: "Move long examples to documentation and keep the description to what the model needs to choose the tool.",
    }] : []),
  make("schema-missing", "error", "Every tool has an inputSchema of type object.", (t) => {
    const s = t.inputSchema;
    if (!s || typeof s !== "object") return [{ message: "The tool has no inputSchema.", fix: "Add { \"type\": \"object\", \"properties\": {} } even when the tool takes no input." }];
    if (s.type !== "object") return [{ path: "inputSchema.type", message: `inputSchema.type is ${JSON.stringify(s.type)}, but it must be "object".`, fix: "Set inputSchema.type to \"object\"." }];
    return [];
  }),
  make("required-unknown", "error", "Every required field is defined in properties.", (t) => {
    const s = t.inputSchema;
    const req = Array.isArray(s?.required) ? (s!.required as unknown[]) : [];
    const p = props(s);
    return req.filter((r) => typeof r !== "string" || !(r in p)).map((r) => ({
      path: "inputSchema.required",
      message: `"${String(r)}" is required but not defined in properties.`,
      fix: "Define the property or remove it from required.",
    }));
  }),
  make("param-description", "warning", "Every parameter has a description.", (t) => {
    const out: Omit<Finding, "rule" | "severity" | "tool">[] = [];
    for (const [path, child] of walk(t.inputSchema)) {
      if (!child || typeof child !== "object" || !child.description) {
        out.push({ path: `inputSchema.${path}`, message: `Parameter "${path}" has no description.`, fix: "Describe the expected value, its format and an example." });
      }
    }
    return out;
  }),
  make("param-type", "warning", "Every parameter declares a type.", (t) => {
    const out: Omit<Finding, "rule" | "severity" | "tool">[] = [];
    for (const [path, child] of walk(t.inputSchema)) {
      if (child && typeof child === "object" && !("type" in child) && !("enum" in child) && !("const" in child)
        && !("anyOf" in child) && !("oneOf" in child) && !("allOf" in child) && !("$ref" in child)) {
        out.push({ path: `inputSchema.${path}`, message: `Parameter "${path}" has no type, so models may send the wrong kind of value.`, fix: "Add a type such as \"string\", \"number\" or \"boolean\"." });
      }
    }
    return out;
  }),
  make("empty-enum", "error", "Enums list at least one value.", (t) => {
    const out: Omit<Finding, "rule" | "severity" | "tool">[] = [];
    for (const [path, child] of walk(t.inputSchema)) {
      if (child && Array.isArray(child.enum) && child.enum.length === 0) out.push({ path: `inputSchema.${path}`, message: `Parameter "${path}" has an empty enum, so no value is valid.`, fix: "List the allowed values or remove enum." });
    }
    return out;
  }),
  make("missing-annotations", "info", "Tools say whether they are read-only or destructive.", (t) => {
    const a = t.annotations ?? {};
    return a.readOnlyHint === undefined && a.destructiveHint === undefined ? [{
      path: "annotations",
      message: "The tool does not set readOnlyHint or destructiveHint, so hosts cannot decide when to ask before running it.",
      fix: "Set annotations.readOnlyHint to true for tools that only read, or destructiveHint to true for tools that delete or overwrite.",
    }] : [];
  }),
  make("conflicting-annotations", "error", "Annotations do not contradict each other.", (t) =>
    t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === true ? [{
      path: "annotations",
      message: "The tool says it is both read-only and destructive.",
      fix: "Pick one. A read-only tool cannot be destructive.",
    }] : []),
  make("heavy-tool", "warning", "No single tool costs more than about 800 tokens of context.", (t) => {
    const n = toolTokens(t);
    return n > 800 ? [{ message: `This tool's definition costs about ${n} tokens on every request.`, fix: "Shorten the description and trim schema text the model does not need." }] : [];
  }),
  {
    id: "heavy-server",
    severity: "warning",
    summary: "The whole tool list stays under about 10,000 tokens.",
    check: (s) => {
      const total = s.tools.reduce((n, t) => n + toolTokens(t), 0);
      return total > 10000 ? [{ rule: "heavy-server", severity: "warning", message: `All ${s.tools.length} tools together cost about ${total} tokens before the agent does any work.`, fix: "Split the server, drop rarely used tools or merge similar ones." }] : [];
    },
  },
  {
    id: "many-tools",
    severity: "info",
    summary: "The server exposes a manageable number of tools.",
    check: (s) => s.tools.length > 40 ? [{ rule: "many-tools", severity: "info", message: `The server exposes ${s.tools.length} tools. Tool choice gets less accurate as the list grows.`, fix: "Group related actions or offer a smaller default set." }] : [],
  },
  {
    id: "similar-names",
    severity: "warning",
    summary: "Tool names are not easily confused.",
    check: (s) => {
      const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
      const out: Finding[] = [];
      const seen = new Map<string, string>();
      for (const t of s.tools) {
        const k = norm(t.name);
        const prev = seen.get(k);
        if (prev && prev !== t.name) out.push({ rule: "similar-names", severity: "warning", tool: t.name, message: `"${t.name}" differs from "${prev}" only by case or punctuation.`, fix: "Rename one so the model can tell them apart." });
        else seen.set(k, t.name);
      }
      return out;
    },
  },
];

rules.push(...probeRules);

export function runRules(snapshot: ServerSnapshot, only?: string[], extra: Rule[] = []): Finding[] {
  const all = [...rules, ...extra];
  const active = only?.length ? all.filter((r) => only.includes(r.id)) : all;
  return active.flatMap((r) => r.check(snapshot));
}
