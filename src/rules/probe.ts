import { Ajv2020 } from "ajv/dist/2020.js";
import type { Finding, ProbeResult, Rule, ServerSnapshot } from "../types.js";

const GENERIC_ERROR = /^(error|failed|internal error|invalid( params| input| arguments)?|bad request|unknown error|exception)\.?$/i;
const LARGE = 10000;

function eachProbe(id: string, severity: Rule["severity"], summary: string,
  fn: (p: ProbeResult, snap: ServerSnapshot) => Omit<Finding, "rule" | "severity" | "tool">[]): Rule {
  return {
    id, severity, summary,
    check: (snap) => (snap.probes ?? []).filter((p) => !p.skipped)
      .flatMap((p) => fn(p, snap).map((f) => ({ rule: id, severity, tool: p.tool, ...f }))),
  };
}

const short = (s: string, n = 120) => (s.length > n ? s.slice(0, n - 3) + "..." : s).replace(/\s+/g, " ");

export const probeRules: Rule[] = [
  eachProbe("probe-timeout", "error", "Tools answer before the timeout.", (p) =>
    p.valid?.timedOut ? [{ message: `The tool did not answer within ${Math.round(p.valid.ms / 1000)} s.`, fix: "Return sooner, or report progress and let the client wait." }] : []),

  eachProbe("probe-crash", "error", "Tools report failures as results, not protocol errors.", (p) =>
    p.valid?.thrown && !p.valid.timedOut ? [{
      message: `A call with valid input failed at the protocol level: ${short(p.valid.thrown)}`,
      fix: "Catch errors inside the tool and return them with isError: true, so the model can read them and try again.",
    }] : []),

  eachProbe("probe-valid-input-error", "info", "Tools accept input that matches their own schema.", (p) =>
    p.valid?.isError ? [{
      message: `Input that matches the schema still returned an error: ${short(p.valid.text)}`,
      fix: "If the schema allows this input, either handle it or tighten the schema (enum, pattern, minimum) so the model cannot send it.",
    }] : []),

  eachProbe("probe-accepts-invalid", "warning", "Tools reject calls that leave out required arguments.", (p) =>
    p.invalid?.ok ? [{
      message: "A call with the required arguments left out succeeded, so the server is not checking its input.",
      fix: "Validate arguments against the input schema and return a clear error when they are wrong.",
    }] : []),

  eachProbe("probe-unhelpful-error", "warning", "Error messages tell the model what went wrong and how to fix it.", (p) => {
    const inv = p.invalid;
    if (!inv || inv.ok || inv.timedOut) return [];
    const text = inv.text.trim();
    if (text.length >= 20 && !GENERIC_ERROR.test(text)) return [];
    return [{
      message: `When required arguments are missing the error only says "${short(text, 60) || "(nothing)"}".`,
      fix: "Name the missing or wrong argument and say what a valid value looks like.",
    }];
  }),

  eachProbe("probe-large-response", "warning", `Responses stay under about ${LARGE.toLocaleString("en-NZ")} tokens.`, (p) =>
    p.valid && p.valid.tokens > LARGE ? [{
      message: `One call returned about ${p.valid.tokens.toLocaleString("en-NZ")} tokens. Some hosts warn or cut output off at this size.`,
      fix: "Page the results, add a limit argument with a small default, or return a summary with ids to fetch details.",
    }] : []),

  eachProbe("probe-output-schema", "error", "Tools with an output schema return matching structured content.", (p, snap) => {
    const tool = snap.tools.find((t) => t.name === p.tool);
    const schema = tool?.outputSchema;
    const v = p.valid;
    if (!schema || !v || !v.ok) return [];
    if (v.structured === undefined) return [{
      message: "The tool declares an output schema but returned no structuredContent.",
      fix: "Return structuredContent that matches outputSchema, as the MCP spec requires.",
    }];
    try {
      const ajv = new Ajv2020({ strict: false, allErrors: false });
      const validate = ajv.compile(schema);
      if (!validate(v.structured)) return [{
        message: `structuredContent does not match the output schema: ${ajv.errorsText(validate.errors)}`,
        fix: "Fix the result or the output schema so they agree.",
      }];
    } catch {
      return [{ message: "The output schema could not be compiled.", fix: "Make outputSchema valid JSON Schema." }];
    }
    return [];
  }),

  {
    id: "probe-skipped",
    severity: "info",
    summary: "Tools that were not called during a probe, and why.",
    check: (snap) => {
      const skipped = (snap.probes ?? []).filter((p) => p.skipped && p.skipped !== "not selected");
      if (!skipped.length) return [];
      return [{
        rule: "probe-skipped", severity: "info",
        message: `${skipped.length} tool(s) were not called because they are not marked read-only: ${skipped.map((p) => p.tool).join(", ")}.`,
        fix: "Mark tools that only read with readOnlyHint: true, or run with --probe-all against a test server.",
      }];
    },
  },
];
