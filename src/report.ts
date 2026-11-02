import type { Finding, ServerSnapshot, Severity } from "./types.js";
import { toolTokens } from "./tokens.js";

export interface Report {
  tool: "mcpmedic";
  version: string;
  server: { name?: string; version?: string; protocolVersion?: string };
  summary: { tools: number; tokens: number; errors: number; warnings: number; infos: number; score: number };
  tokensByTool: { name: string; tokens: number }[];
  findings: Finding[];
  /** Version of the host rule pack used, if any. */
  hostPack?: string;
}

const WEIGHT: Record<Severity, number> = { error: 10, warning: 3, info: 0 };

/** Host rules are reported but do not change the score. 100 minus a penalty per finding, scaled by the number of tools, floored at 0. */
export function score(findings: Finding[], tools: number): number {
  const penalty = findings.reduce((n, f) => n + WEIGHT[f.severity], 0);
  return Math.max(0, Math.round(100 - (penalty / Math.max(1, tools)) * 5));
}

export function buildReport(snap: ServerSnapshot, findings: Finding[], version: string): Report {
  const count = (s: Severity) => findings.filter((f) => f.severity === s).length;
  const tokensByTool = snap.tools.map((t) => ({ name: t.name, tokens: toolTokens(t) })).sort((a, b) => b.tokens - a.tokens);
  return {
    tool: "mcpmedic",
    version,
    server: { name: snap.serverName, version: snap.serverVersion, protocolVersion: snap.protocolVersion },
    summary: {
      tools: snap.tools.length,
      tokens: tokensByTool.reduce((n, t) => n + t.tokens, 0),
      errors: count("error"),
      warnings: count("warning"),
      infos: count("info"),
      score: score(findings.filter((f) => !f.host), snap.tools.length),
    },
    tokensByTool,
    findings,
  };
}

export function formatText(r: Report, color = false): string {
  const c = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const mark: Record<Severity, string> = { error: c("31", "error"), warning: c("33", "warn "), info: c("36", "info ") };
  const lines: string[] = [];
  const name = [r.server.name, r.server.version].filter(Boolean).join(" ") || "MCP server";
  lines.push(c("1", `mcpmedic ${r.version}: ${name}`));
  if (r.server.protocolVersion) lines.push(`Protocol ${r.server.protocolVersion}`);
  lines.push(`${r.summary.tools} tools, about ${r.summary.tokens} tokens of context`, "");
  for (const f of r.findings) {
    const where = [f.tool, f.path].filter(Boolean).join(" ");
    lines.push(`  ${mark[f.severity]}  ${f.rule.padEnd(22)} ${where ? where + ": " : ""}${f.message}`);
    if (f.fix) lines.push(`         ${" ".repeat(22)} fix: ${f.fix}`);
    if (f.source) lines.push(`         ${" ".repeat(22)} source: ${f.source}`);
  }
  if (r.findings.length) lines.push("");
  const top = r.tokensByTool.slice(0, 5).map((t) => `${t.name} (${t.tokens})`).join(", ");
  if (top) lines.push(`Heaviest tools: ${top}`);
  lines.push(c("1", `Score ${r.summary.score}/100: ${r.summary.errors} errors, ${r.summary.warnings} warnings, ${r.summary.infos} notes`));
  return lines.join("\n");
}
