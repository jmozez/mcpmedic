// A Streamable HTTP MCP server on a random port that requires a bearer token. Prints its URL.
import http from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const httpServer = http.createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer letmein") { res.writeHead(401).end("no"); return; }
  const server = new Server({ name: "http-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "ping", description: "Checks that the server is up and returns pong. Use it before other calls.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }],
  }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  let body = "";
  for await (const chunk of req) body += chunk;
  await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
});
httpServer.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${httpServer.address().port}/mcp`));
