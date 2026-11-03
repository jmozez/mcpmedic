import type { Report } from "./report.js";
import { rules } from "./rules/index.js";
import type { Severity } from "./types.js";

const LEVEL: Record<Severity, "error" | "warning" | "note"> = { error: "error", warning: "warning", info: "note" };
const REPO = "https://github.com/jmozez/mcpmedic";

export interface SarifOptions {
  /** File the results point at, relative to the repository root. Defaults to the --file path, or mcp-server. */
  uri?: string;
}

/** SARIF 2.1.0, as read by GitHub code scanning and most editors. */
export function formatSarif(r: Report, o: SarifOptions = {}): string {
  const known = new Map(rules.map((x) => [x.id, x]));
  const ids = [...new Set(r.findings.map((f) => f.rule))];
  const descriptors = ids.map((id) => {
    const rule = known.get(id);
    const f = r.findings.find((x) => x.rule === id)!;
    return {
      id,
      name: id.replace(/(^|[-_.:])(\w)/g, (_, __, c: string) => c.toUpperCase()),
      shortDescription: { text: rule?.summary ?? f.message },
      ...(f.fix ? { help: { text: f.fix } } : {}),
      helpUri: f.source ?? `${REPO}#readme`,
      defaultConfiguration: { level: LEVEL[rule?.severity ?? f.severity] },
      properties: { tags: f.host ? ["mcp", "host", f.host] : ["mcp"] },
    };
  });
  const uri = (o.uri ?? "mcp-server").replace(/\\/g, "/").replace(/^\.\//, "");
  const results = r.findings.map((f) => ({
    ruleId: f.rule,
    ruleIndex: ids.indexOf(f.rule),
    level: LEVEL[f.severity],
    message: { text: f.fix ? `${f.message} Fix: ${f.fix}` : f.message },
    locations: [{
      physicalLocation: { artifactLocation: { uri }, region: { startLine: 1 } },
      ...(f.tool ? { logicalLocations: [{ name: f.tool, fullyQualifiedName: f.path ? `${f.tool}.${f.path}` : f.tool, kind: "function" }] } : {}),
    }],
    partialFingerprints: { mcpmedic: [f.rule, f.tool ?? "", f.path ?? "", f.host ?? ""].join("/") },
  }));
  return JSON.stringify({
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "mcpmedic", version: r.version, informationUri: REPO, rules: descriptors } },
      results,
      properties: { score: r.summary.score, server: r.server, hostPack: r.hostPack },
    }],
  }, null, 2);
}
