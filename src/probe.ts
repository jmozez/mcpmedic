import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { withTimeout } from "./connect.js";
import { sampleArguments } from "./sample.js";
import { estimateTokens } from "./tokens.js";
import type { CallOutcome, ProbeResult, ServerSnapshot, ToolDefinition } from "./types.js";

export interface ProbeOptions {
  /** Also call tools that are not marked read-only. Off by default, because calls can change things. */
  all?: boolean;
  /** Only probe these tools. */
  only?: string[];
  timeoutMs?: number;
}

function textOf(result: unknown): string {
  const content = (result as { content?: unknown[] })?.content;
  if (!Array.isArray(content)) return JSON.stringify(result ?? "");
  return content.map((c) => {
    const item = c as { type?: string; text?: string };
    return item.type === "text" ? item.text ?? "" : JSON.stringify(item);
  }).join("\n");
}

export async function callOnce(client: Client, name: string, args: Record<string, unknown>, timeoutMs: number): Promise<CallOutcome> {
  const start = performance.now();
  try {
    const result = await withTimeout(
      // A raw request, so the SDK does not validate structured output itself: that is our job.
      client.request({ method: "tools/call", params: { name, arguments: args } }, CallToolResultSchema, { timeout: timeoutMs }),
      timeoutMs + 1000,
      `the tool "${name}"`,
    );
    const text = textOf(result);
    return {
      ok: !result.isError,
      isError: Boolean(result.isError),
      ms: Math.round(performance.now() - start),
      text,
      tokens: estimateTokens(text),
      structured: result.structuredContent,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      thrown: message,
      timedOut: /timed out|no answer/i.test(message),
      ms: Math.round(performance.now() - start),
      text: message,
      tokens: estimateTokens(message),
    };
  }
}

function skipReason(tool: ToolDefinition, opts: ProbeOptions): string | undefined {
  if (opts.only?.length && !opts.only.includes(tool.name)) return "not selected";
  if (opts.all) return undefined;
  if (tool.annotations?.readOnlyHint !== true) return "not marked read-only (use --probe-all to call it anyway)";
  return undefined;
}

/** Calls each safe tool once with valid sample input, and once with its required arguments left out. */
export async function probe(client: Client, snap: ServerSnapshot, opts: ProbeOptions = {}): Promise<ProbeResult[]> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const results: ProbeResult[] = [];
  for (const tool of snap.tools) {
    const skipped = skipReason(tool, opts);
    if (skipped) { results.push({ tool: tool.name, skipped }); continue; }
    const input = sampleArguments(tool.inputSchema);
    const valid = await callOnce(client, tool.name, input, timeoutMs);
    const required = (tool.inputSchema as { required?: unknown })?.required;
    const invalid = Array.isArray(required) && required.length
      ? await callOnce(client, tool.name, {}, timeoutMs)
      : undefined;
    results.push({ tool: tool.name, input, valid, invalid });
  }
  return results;
}
