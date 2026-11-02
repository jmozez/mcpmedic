import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Finding, Rule, ServerSnapshot, Severity, ToolDefinition } from "./types.js";

export type HostCheck =
  | { type: "name-pattern"; pattern: string }
  | { type: "name-length"; max: number; template: string }
  | { type: "property-names"; pattern: string }
  | { type: "schema-meta-2020" }
  | { type: "root-combinator" }
  | { type: "max-tools"; max: number }
  | { type: "instructions-length"; max: number }
  | { type: "read-only-hint" }
  | { type: "response-tokens"; max: number }
  | { type: "call-ms"; max: number }
  | { type: "startup-ms"; max: number };

export interface HostRule {
  id: string;
  host: string;
  severity: Severity;
  summary: string;
  check: HostCheck;
  fix?: string;
  source: string;
  quote: string;
  checked: string;
}

export interface HostPack {
  version: string;
  hosts: Record<string, string>;
  rules: HostRule[];
}

const PACK_PATH = fileURLToPath(new URL("../hosts/hosts.yaml", import.meta.url));

export function loadHostPack(path = PACK_PATH): HostPack {
  const pack = parse(readFileSync(path, "utf8")) as HostPack;
  pack.version = String(pack.version);
  for (const r of pack.rules) {
    if (!pack.hosts[r.host]) throw new Error(`Host rule ${r.id} names an unknown host "${r.host}".`);
    if (!r.source?.startsWith("https://")) throw new Error(`Host rule ${r.id} has no source link.`);
  }
  return pack;
}

let ajv: Ajv2020 | undefined;
function validSchema2020(schema: unknown): string | undefined {
  ajv ??= new Ajv2020({ strict: false, validateSchema: true });
  if (ajv.validateSchema(schema as object) === true) return undefined;
  return ajv.errorsText(ajv.errors);
}

type Hit = Omit<Finding, "rule" | "severity">;

function perTool(snap: ServerSnapshot, fn: (t: ToolDefinition) => Omit<Hit, "tool"> | undefined): Hit[] {
  return snap.tools.flatMap((t) => {
    const h = fn(t);
    return h ? [{ tool: t.name, ...h }] : [];
  });
}

export interface HostContext {
  /** The name users give the server in their config, used for prefixed names. */
  serverName?: string;
}

function evaluate(c: HostCheck, snap: ServerSnapshot, ctx: HostContext): Hit[] {
  switch (c.type) {
    case "name-pattern": {
      const re = new RegExp(c.pattern);
      return perTool(snap, (t) => re.test(t.name) ? undefined : { message: `The name "${t.name}" does not match ${c.pattern}.` });
    }
    case "name-length": {
      const server = (ctx.serverName ?? snap.serverName ?? "server").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      return perTool(snap, (t) => {
        const full = c.template.replace("{server}", server).replace("{tool}", t.name);
        return full.length > c.max ? { message: `The full name "${full}" is ${full.length} characters, over ${c.max}.` } : undefined;
      });
    }
    case "property-names": {
      const re = new RegExp(c.pattern);
      return perTool(snap, (t) => {
        const props = Object.keys((t.inputSchema?.properties ?? {}) as object).filter((k) => !re.test(k));
        return props.length ? { message: `Parameter name(s) ${props.map((p) => `"${p}"`).join(", ")} do not match ${c.pattern}.` } : undefined;
      });
    }
    case "schema-meta-2020":
      return perTool(snap, (t) => {
        const s = t.inputSchema;
        if (!s) return undefined;
        const dialect = typeof s.$schema === "string" ? s.$schema : undefined;
        if (dialect && !dialect.includes("2020-12")) return undefined;
        const err = validSchema2020(s);
        return err ? { message: `The input schema is not valid draft 2020-12: ${err}.` } : undefined;
      });
    case "root-combinator":
      return perTool(snap, (t) => {
        const keys = ["anyOf", "oneOf", "allOf"].filter((k) => t.inputSchema && k in t.inputSchema);
        return keys.length ? { message: `The input schema has ${keys.join(" and ")} at the root.` } : undefined;
      });
    case "max-tools":
      return snap.tools.length > c.max ? [{ message: `The server exposes ${snap.tools.length} tools, over ${c.max}.` }] : [];
    case "instructions-length": {
      const n = snap.instructions?.length ?? 0;
      return n > c.max ? [{ message: `The server instructions are ${n} characters. Only the first ${c.max} may be read when tools are chosen.` }] : [];
    }
    case "read-only-hint":
      return perTool(snap, (t) => t.annotations?.readOnlyHint === undefined && t.annotations?.destructiveHint !== true
        ? { message: "The tool does not say whether it is read-only." } : undefined);
    case "response-tokens":
      return (snap.probes ?? []).flatMap((p) => p.valid && p.valid.tokens > c.max
        ? [{ tool: p.tool, message: `A probe call returned about ${p.valid.tokens.toLocaleString("en-NZ")} tokens, over ${c.max.toLocaleString("en-NZ")}.` }] : []);
    case "call-ms":
      return (snap.probes ?? []).flatMap((p) => p.valid && p.valid.ms > c.max
        ? [{ tool: p.tool, message: `A probe call took ${(p.valid.ms / 1000).toFixed(1)} s, over ${c.max / 1000} s.` }] : []);
    case "startup-ms":
      return snap.startupMs !== undefined && snap.startupMs > c.max
        ? [{ message: `The server took ${(snap.startupMs / 1000).toFixed(1)} s to start and list its tools, over ${c.max / 1000} s.` }] : [];
  }
}

/** Turns host rules into ordinary rules. Each finding names the host and links the source. */
export function hostRules(pack: HostPack, hosts?: string[], ctx: HostContext = {}): Rule[] {
  return pack.rules
    .filter((r) => !hosts?.length || hosts.includes(r.host))
    .map((r) => ({
      id: r.id,
      severity: r.severity,
      summary: `${pack.hosts[r.host]}: ${r.summary}`,
      check: (snap: ServerSnapshot) => evaluate(r.check, snap, ctx).map((h) => ({
        rule: r.id,
        severity: r.severity,
        ...h,
        message: `[${r.host}] ${h.message}`,
        fix: r.fix,
        source: r.source,
        host: r.host,
      })),
    }));
}
