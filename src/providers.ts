import type { ToolDefinition } from "./types.js";

/** What a model chose when shown the tools and one prompt. */
export interface Choice {
  /** The tool it called, or null if it answered without one. */
  tool: string | null;
  args?: Record<string, unknown>;
  /** Any text it wrote instead of, or as well as, the call. */
  text?: string;
}

export interface ChooseRequest {
  system?: string;
  prompt: string;
  tools: ToolDefinition[];
}

export interface Provider {
  /** For example "openai:gpt-4o-mini". */
  id: string;
  choose(req: ChooseRequest): Promise<Choice>;
  /** Plain text completion, used by fix mode to rewrite descriptions. */
  complete(system: string, prompt: string): Promise<string>;
}

export interface ProviderOptions {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  temperature?: number;
  timeoutMs?: number;
}

/** Function names some APIs accept. Others are mapped and mapped back. */
const SAFE = /^[a-zA-Z0-9_-]{1,64}$/;

function nameMap(tools: ToolDefinition[]) {
  const out = new Map<string, string>();
  const back = new Map<string, string>();
  tools.forEach((t, i) => {
    let n = SAFE.test(t.name) ? t.name : t.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 56) || "tool";
    if (back.has(n)) n = `${n.slice(0, 56)}_${i}`;
    out.set(t.name, n);
    back.set(n, t.name);
  });
  return { out, back };
}

function schemaOf(t: ToolDefinition): Record<string, unknown> {
  const s = t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : {};
  return { type: "object", properties: {}, ...s };
}

function parseArgs(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

async function post(f: typeof fetch, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const res = await f(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} answered ${res.status}: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
  return JSON.parse(text);
}

/** Any API that speaks the OpenAI chat completions format: OpenAI, OpenRouter, Ollama, LM Studio, vLLM. */
export function openAICompatible(id: string, baseUrl: string, model: string, apiKey: string | undefined, o: ProviderOptions = {}): Provider {
  const f = o.fetch ?? fetch;
  return {
    id,
    async choose({ system, prompt, tools }) {
      const { out, back } = nameMap(tools);
      const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }];
      const body = {
        model,
        messages,
        temperature: o.temperature ?? 0,
        tools: tools.map((t) => ({
          type: "function",
          function: { name: out.get(t.name), description: t.description ?? "", parameters: schemaOf(t) },
        })),
        tool_choice: "auto",
      };
      const data = await post(f, `${baseUrl.replace(/\/$/, "")}/chat/completions`, apiKey ? { authorization: `Bearer ${apiKey}` } : {}, body, o.timeoutMs ?? 60_000);
      const msg = data?.choices?.[0]?.message ?? {};
      const call = msg.tool_calls?.[0]?.function;
      if (!call) return { tool: null, text: msg.content ?? undefined };
      return { tool: back.get(call.name) ?? call.name, args: parseArgs(call.arguments), text: msg.content ?? undefined };
    },
    async complete(system, prompt) {
      const body = { model, temperature: o.temperature ?? 0, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] };
      const data = await post(f, `${baseUrl.replace(/\/$/, "")}/chat/completions`, apiKey ? { authorization: `Bearer ${apiKey}` } : {}, body, o.timeoutMs ?? 60_000);
      return String(data?.choices?.[0]?.message?.content ?? "");
    },
  };
}

export function anthropic(model: string, apiKey: string, o: ProviderOptions = {}, baseUrl = "https://api.anthropic.com"): Provider {
  const f = o.fetch ?? fetch;
  return {
    id: `anthropic:${model}`,
    async choose({ system, prompt, tools }) {
      const { out, back } = nameMap(tools);
      const body = {
        model,
        max_tokens: 1024,
        temperature: o.temperature ?? 0,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: prompt }],
        tools: tools.map((t) => ({ name: out.get(t.name), description: t.description ?? "", input_schema: schemaOf(t) })),
      };
      const data = await post(f, `${baseUrl.replace(/\/$/, "")}/v1/messages`, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body, o.timeoutMs ?? 60_000);
      const blocks: Array<Record<string, unknown>> = data?.content ?? [];
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n") || undefined;
      const use = blocks.find((b) => b.type === "tool_use");
      if (!use) return { tool: null, text };
      return { tool: back.get(String(use.name)) ?? String(use.name), args: parseArgs(use.input), text };
    },
    async complete(system, prompt) {
      const body = { model, max_tokens: 1024, temperature: o.temperature ?? 0, system, messages: [{ role: "user", content: prompt }] };
      const data = await post(f, `${baseUrl.replace(/\/$/, "")}/v1/messages`, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body, o.timeoutMs ?? 60_000);
      return (data?.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
    },
  };
}

const STOP = new Set("a an the and or of to in on for with is are be it this that what how do does my me i you your please can from at by as".split(" "));
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)));

/**
 * A model that needs no key or network: it picks the tool whose name and description share the most
 * words with the prompt. It is for tests and dry runs, not for judging a real server.
 */
export function mock(): Provider {
  return {
    id: "mock",
    async choose({ prompt, tools }) {
      const p = words(prompt);
      let best: string | null = null;
      let bestScore = 0;
      for (const t of tools) {
        const w = words(`${t.name.replace(/[_.-]/g, " ")} ${t.description ?? ""}`);
        let s = 0;
        for (const x of p) if (w.has(x)) s++;
        if (s > bestScore) { best = t.name; bestScore = s; }
      }
      return { tool: best };
    },
    /** Echoes the lines after "Prompts that should use it:" as a description, so fix mode can be tested offline. */
    async complete(_system, prompt) {
      const want = prompt.split("Prompts that should use it:")[1]?.split("\n\n")[0] ?? "";
      const asks = want.split("\n").map((l) => l.replace(/^- /, "").trim()).filter(Boolean);
      const name = /Tool: (.+)/.exec(prompt)?.[1] ?? "this tool";
      return asks.length ? `Use ${name} when the user asks things like: ${asks.join("; ")}.` : `Use ${name} for its stated purpose.`;
    },
  };
}

/**
 * Builds a provider from "provider:model". Keys come only from environment variables:
 * OPENAI_API_KEY (and OPENAI_BASE_URL), OPENROUTER_API_KEY, ANTHROPIC_API_KEY, OLLAMA_HOST.
 */
export function makeProvider(spec: string, o: ProviderOptions = {}): Provider {
  const env = o.env ?? process.env;
  if (spec === "mock") return mock();
  const i = spec.indexOf(":");
  if (i < 1 || i === spec.length - 1) throw new Error(`--model should look like provider:model, for example ollama:llama3.1. Got "${spec}".`);
  const kind = spec.slice(0, i);
  const model = spec.slice(i + 1);
  const need = (name: string) => {
    const v = env[name];
    if (!v) throw new Error(`Set ${name} in the environment to use ${kind}. mcpmedic never asks for keys on the command line.`);
    return v;
  };
  switch (kind) {
    case "openai":
      return openAICompatible(spec, env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", model, need("OPENAI_API_KEY"), o);
    case "openrouter":
      return openAICompatible(spec, "https://openrouter.ai/api/v1", model, need("OPENROUTER_API_KEY"), o);
    case "ollama": {
      const host = (env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/, "");
      return openAICompatible(spec, `${/^https?:/.test(host) ? host : `http://${host}`}/v1`, model, undefined, o);
    }
    case "compatible":
      return openAICompatible(spec, need("MCPMEDIC_BASE_URL"), model, env.MCPMEDIC_API_KEY, o);
    case "anthropic":
      return anthropic(model, need("ANTHROPIC_API_KEY"), o, env.ANTHROPIC_BASE_URL);
    default:
      throw new Error(`Unknown provider "${kind}". Use openai, openrouter, ollama, anthropic, compatible or mock.`);
  }
}
