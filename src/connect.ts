import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ServerSnapshot, ToolDefinition } from "./types.js";

export type Target =
  | { kind: "stdio"; command: string; args: string[]; env?: Record<string, string> }
  | { kind: "http"; url: string; headers?: Record<string, string> }
  | { kind: "file"; path: string };

const CLIENT_INFO = { name: "mcpmedic", version: "0.1.0" };

async function listAll(client: Client): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...(page.tools as ToolDefinition[]));
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

async function snapshotFrom(client: Client): Promise<ServerSnapshot> {
  const info = client.getServerVersion();
  return {
    serverName: info?.name,
    serverVersion: info?.version,
    protocolVersion: (client as unknown as { _negotiatedProtocolVersion?: string })._negotiatedProtocolVersion,
    instructions: client.getInstructions(),
    tools: await listAll(client),
  };
}

/** Reads a saved tools/list result: either { tools: [...] } or a bare array. */
export async function fromFile(path: string): Promise<ServerSnapshot> {
  const data = JSON.parse(await readFile(path, "utf8"));
  const tools = Array.isArray(data) ? data : data?.tools ?? data?.result?.tools;
  if (!Array.isArray(tools)) throw new Error(`${path} does not contain a tools array.`);
  return { serverName: data?.serverName, instructions: data?.instructions, tools };
}

export interface Session {
  client: Client;
  snapshot: ServerSnapshot;
  close(): Promise<void>;
}

export function withTimeout<T>(p: Promise<T>, timeoutMs: number, what = "the server"): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      // Not unref'd: if the only other handle is a stalled server, an unref'd timer lets Node exit with code 0 and no output.
      timer = setTimeout(() => reject(new Error(`No answer from ${what} within ${timeoutMs / 1000} s.`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Connects to a live server and keeps the connection open, for probes and evals. */
export async function openSession(target: Exclude<Target, { kind: "file" }>, timeoutMs = 30000): Promise<Session> {
  const started = performance.now();
  const ready = async (client: Client): Promise<Session> => {
    const snap = await withTimeout(snapshotFrom(client), timeoutMs);
    snap.startupMs = Math.round(performance.now() - started);
    return { client, snapshot: snap, close: () => client.close().catch(() => undefined) };
  };

  if (target.kind === "stdio") {
    const client = new Client(CLIENT_INFO);
    const transport = new StdioClientTransport({
      command: target.command,
      args: target.args,
      env: { ...(process.env as Record<string, string>), ...target.env },
      stderr: "pipe",
    });
    // Drain the server's stderr. An unread pipe fills up and blocks a chatty server.
    transport.stderr?.on("data", () => undefined);
    try {
      await withTimeout(client.connect(transport), timeoutMs);
      return await ready(client);
    } catch (e) {
      await client.close().catch(() => undefined);
      throw e;
    }
  }

  const url = new URL(target.url);
  const requestInit = target.headers ? { headers: target.headers } : undefined;
  const client = new Client(CLIENT_INFO);
  try {
    await withTimeout(client.connect(new StreamableHTTPClientTransport(url, { requestInit })), timeoutMs);
    return await ready(client);
  } catch (first) {
    // Older servers only speak the deprecated HTTP+SSE transport.
    await client.close().catch(() => undefined);
    const legacy = new Client(CLIENT_INFO);
    try {
      await withTimeout(legacy.connect(new SSEClientTransport(url, { requestInit })), timeoutMs);
      return await ready(legacy);
    } catch {
      await legacy.close().catch(() => undefined);
      throw first;
    }
  }
}

/** Reads the tool list once and disconnects. */
export async function snapshot(target: Target, timeoutMs = 30000): Promise<ServerSnapshot> {
  if (target.kind === "file") return fromFile(target.path);
  const session = await openSession(target, timeoutMs);
  try {
    return session.snapshot;
  } finally {
    await session.close();
  }
}
