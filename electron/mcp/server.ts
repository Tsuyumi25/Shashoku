import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { askRenderer } from "./bridge";
import { renderTexts } from "@shared/mcp/render";
import type { PageTexts } from "@shared/mcp/types";

const DEFAULT_PORT = 8747;

/**
 * The token is the signature: anything that arrives without it is not the
 * agent the user connected, however local the socket is. clientInfo is
 * self-reported and the spec forbids trusting it, so this header is the only
 * authentication there is.
 */
const token = process.env.SHASHOKU_MCP_TOKEN ?? randomBytes(16).toString("hex");

function buildServer(): McpServer {
  const server = new McpServer({ name: "shashoku", version: "0.0.0" });

  server.registerTool(
    "get_texts",
    {
      title: "Read every text object's source and translation",
      description:
        "Read-only. Lists every text object in the open Shashoku project, page by page " +
        "in reading order: the object's id, its source text (原文) and what it currently " +
        "reads as (譯文). An empty 譯文 means the object is untranslated.",
    },
    async () => {
      try {
        const pages = await askRenderer<PageTexts[]>("get_texts");
        return { content: [{ type: "text", text: renderTexts(pages) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: String(err instanceof Error ? err.message : err) }],
          isError: true,
        };
      }
    },
  );

  return server;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401, { "content-type": "application/json" }).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: "unauthorized: missing or wrong bearer token" },
        id: null,
      }),
    );
    return;
  }
  // Stateless: a fresh server per request keeps request ids from colliding
  // across concurrent clients, and there is no session state worth keeping yet.
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

export function startMcpServer() {
  const port = Number(process.env.SHASHOKU_MCP_PORT ?? DEFAULT_PORT);
  const httpServer = createServer((req, res) => {
    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404).end();
      return;
    }
    void handleMcp(req, res).catch((err) => {
      console.error("[mcp] request failed", err);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  httpServer.on("error", (err) => {
    console.error("[mcp] server error — MCP endpoint unavailable", err);
  });
  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`[mcp] listening on http://127.0.0.1:${port}/mcp`);
    console.log(`[mcp] bearer token: ${token}`);
  });
  return httpServer;
}
