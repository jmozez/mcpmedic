import { describe, expect, it } from "vitest";
import { makeProvider, mock } from "../src/providers.js";
import type { ToolDefinition } from "../src/types.js";

const tools: ToolDefinition[] = [
  { name: "get_weather", description: "Get the current weather for a city.", inputSchema: { type: "object", properties: { city: { type: "string" } } } },
  { name: "files.search", description: "Search files by name." },
];

function fakeFetch(reply: unknown, seen: Array<{ url: string; body: any; headers: any }>): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url, body: JSON.parse(String(init.body)), headers: init.headers });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("providers", () => {
  it("speaks the OpenAI format and maps unsafe names back", async () => {
    const seen: any[] = [];
    const p = makeProvider("openai:gpt-test", {
      env: { OPENAI_API_KEY: "k" },
      fetch: fakeFetch({ choices: [{ message: { tool_calls: [{ function: { name: "files_search", arguments: '{"q":"x"}' } }] } }] }, seen),
    });
    const c = await p.choose({ prompt: "find x", tools });
    expect(c).toEqual({ tool: "files.search", args: { q: "x" }, text: undefined });
    expect(seen[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(seen[0].headers.authorization).toBe("Bearer k");
    expect(seen[0].body.tools[1].function.name).toBe("files_search");
    expect(seen[0].body.tools[1].function.parameters).toEqual({ type: "object", properties: {} });
  });

  it("returns no tool when the model just answers", async () => {
    const p = makeProvider("ollama:llama3.1", { env: {}, fetch: fakeFetch({ choices: [{ message: { content: "Hi" } }] }, []) });
    expect(await p.choose({ prompt: "hello", tools })).toEqual({ tool: null, text: "Hi" });
  });

  it("uses OLLAMA_HOST without a scheme", async () => {
    const seen: any[] = [];
    const p = makeProvider("ollama:m", { env: { OLLAMA_HOST: "10.0.0.2:11434" }, fetch: fakeFetch({ choices: [{ message: {} }] }, seen) });
    await p.choose({ prompt: "x", tools });
    expect(seen[0].url).toBe("http://10.0.0.2:11434/v1/chat/completions");
  });

  it("speaks the Anthropic format", async () => {
    const seen: any[] = [];
    const p = makeProvider("anthropic:claude-test", {
      env: { ANTHROPIC_API_KEY: "k" },
      fetch: fakeFetch({ content: [{ type: "text", text: "Checking." }, { type: "tool_use", name: "get_weather", input: { city: "Wellington" } }] }, seen),
    });
    const c = await p.choose({ system: "Be brief.", prompt: "weather in Wellington", tools });
    expect(c).toEqual({ tool: "get_weather", args: { city: "Wellington" }, text: "Checking." });
    expect(seen[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0].headers["x-api-key"]).toBe("k");
    expect(seen[0].body.system).toBe("Be brief.");
    expect(seen[0].body.tools[0].input_schema.properties.city.type).toBe("string");
  });

  it("asks for keys from the environment only", () => {
    expect(() => makeProvider("openai:x", { env: {} })).toThrow(/OPENAI_API_KEY/);
    expect(() => makeProvider("nope:x", { env: {} })).toThrow(/Unknown provider/);
    expect(() => makeProvider("openai", { env: {} })).toThrow(/provider:model/);
  });

  it("reports API errors with the status", async () => {
    const f = (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch;
    const p = makeProvider("openrouter:x", { env: { OPENROUTER_API_KEY: "k" }, fetch: f });
    await expect(p.choose({ prompt: "x", tools })).rejects.toThrow(/401/);
  });

  it("the mock picks by shared words", async () => {
    expect((await mock().choose({ prompt: "What is the weather in Wellington?", tools })).tool).toBe("get_weather");
    expect((await mock().choose({ prompt: "search my files", tools })).tool).toBe("files.search");
    expect((await mock().choose({ prompt: "tell a joke", tools })).tool).toBeNull();
  });
});
