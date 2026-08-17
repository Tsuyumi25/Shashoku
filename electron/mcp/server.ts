import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { askRenderer } from "./bridge";
import { renderProposeOutcomes, renderTexts } from "@shared/mcp/render";
import type { PageTexts, ProposeOutcome } from "@shared/mcp/types";

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
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "propose_translations",
    {
      title: "Propose translation candidates",
      description:
        "Append translation candidates to text objects on one page. Never overwrites: every " +
        "item lands in the object's candidate drawer. Where the object currently reads as " +
        "nothing at all, the new candidate also takes effect immediately; anywhere else the " +
        "person keeps what they chose and picks from the drawer. items[].lines is one array " +
        "entry per rendered line — no embedded newlines.",
      inputSchema: {
        page_id: z.string(),
        items: z
          .array(z.object({ object_id: z.string(), lines: z.array(z.string()) }))
          .min(1),
      },
    },
    async ({ page_id, items }) => {
      try {
        const outcomes = await askRenderer<ProposeOutcome[]>("propose_translations", {
          pageId: page_id,
          items: items.map((i) => ({ objectId: i.object_id, lines: i.lines })),
        });
        return { content: [{ type: "text", text: renderProposeOutcomes(outcomes) }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "choose_translation",
    {
      title: "Point an object at one of its translation candidates",
      description:
        "Move a text object's translation slot to a candidate already in its drawer " +
        "(candidate ids are listed by get_texts). Nothing is deleted: the previous choice " +
        "stays in the drawer.",
      inputSchema: {
        page_id: z.string(),
        object_id: z.string(),
        translation_id: z.string(),
      },
    },
    async ({ page_id, object_id, translation_id }) => {
      try {
        await askRenderer("choose_translation", {
          pageId: page_id,
          objectId: object_id,
          translationId: translation_id,
        });
        return {
          content: [{ type: "text", text: `${object_id} 現在讀作候選 ${translation_id}` }],
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  return server;
}

function toolError(err: unknown) {
  return {
    content: [{ type: "text" as const, text: String(err instanceof Error ? err.message : err) }],
    isError: true,
  };
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
