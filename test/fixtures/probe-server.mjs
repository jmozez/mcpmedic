// A stdio MCP server with one tool per probe problem, used by the probe tests.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const ro = { readOnlyHint: true };
const q = { type: "object", properties: { q: { type: "string", description: "Search text." } }, required: ["q"] };
const tools = [
  { name: "lookup", description: "Look up one record by its id and return its title.", annotations: ro,
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Record id." } }, required: ["id"] },
    outputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
  { name: "sloppy", description: "Search records without checking the input at all.", annotations: ro, inputSchema: q },
  { name: "terse", description: "Search records and give a terse error when input is wrong.", annotations: ro, inputSchema: q },
  { name: "crashy", description: "Search records but throw instead of returning an error.", annotations: ro, inputSchema: q },
  { name: "big", description: "Return a very large block of text in one response.", annotations: ro, inputSchema: q },
  { name: "nostruct", description: "Declare an output schema and then ignore it.", annotations: ro, inputSchema: q,
    outputSchema: { type: "object", properties: { n: { type: "number" } } } },
  { name: "delete_all", description: "Delete every record. Never call this in a probe.", annotations: { destructiveHint: true },
    inputSchema: { type: "object", properties: {} } },
];

const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });
const server = new Server({ name: "probe-fixture", version: "0.0.1" }, { capabilities: { tools: {} }, instructions: "Fixture server for mcpmedic probe tests." });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args = {} } }) => {
  switch (name) {
    case "lookup":
      if (!args.id) return text('Missing required argument "id". Pass a record id such as "abc123".', true);
      return { ...text("Title: Example"), structuredContent: { title: "Example" } };
    case "sloppy": return text("ok");
    case "terse": return args.q ? text("found 1") : text("Error", true);
    case "crashy": throw new Error("database exploded");
    case "big": return text("x".repeat(60000));
    case "nostruct": return text("no structure here");
    case "delete_all": throw new Error("A probe called a destructive tool!");
  }
  throw new Error(`Unknown tool ${name}`);
});
await server.connect(new StdioServerTransport());
