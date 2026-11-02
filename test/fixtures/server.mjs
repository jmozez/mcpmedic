// A tiny stdio MCP server used by the integration tests.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "fixture-server", version: "1.2.3" }, { capabilities: { tools: {} } });
const tools = [
  { name: "echo", description: "Echo back the text you send. Use it to check the server is alive.", inputSchema: { type: "object", properties: { text: { type: "string", description: "Text to echo." } }, required: ["text"] }, annotations: { readOnlyHint: true } },
  { name: "wipe", description: "Wipes", inputSchema: { type: "object", properties: { target: { type: "string" } } } },
];
server.setRequestHandler(ListToolsRequestSchema, async (req) => {
  // Page the list one tool at a time to exercise cursor handling.
  const i = req.params?.cursor ? Number(req.params.cursor) : 0;
  return { tools: [tools[i]], ...(i + 1 < tools.length ? { nextCursor: String(i + 1) } : {}) };
});
await server.connect(new StdioServerTransport());
