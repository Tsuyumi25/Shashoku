import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
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
 *
 * Minted once and kept in userData, because the client keeps it too: a token
 * that changed every launch would have the user re-pairing every agent every
 * morning. Empty until loadToken resolves, and the listener only starts after
 * it has — an empty token never authenticates anything.
 */
let token = "";

async function loadToken(): Promise<string> {
  const fromEnv = process.env.SHASHOKU_MCP_TOKEN;
  if (fromEnv) return fromEnv;
  const path = join(app.getPath("userData"), "mcp-token");
  try {
    const held = (await readFile(path, "utf8")).trim();
    if (held !== "") return held;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const minted = randomBytes(16).toString("hex");
  await writeFile(path, `${minted}\n`, { mode: 0o600 });
  return minted;
}

/**
 * `getSource` answers with the session's clientInfo at call time — the
 * handshake happens after construction, so it cannot be read here and held.
 * It is the server stamping who spoke, not the model signing itself.
 */
function buildServer(getSource: () => string | undefined): McpServer {
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
          source: getSource(),
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

/**
 * Sessions rather than stateless, because identity lives in the handshake:
 * clientInfo arrives once at initialize, and a per-request server would be
 * meeting every tool call as a stranger.
 */
const transports = new Map<string, StreamableHTTPServerTransport>();

function clientLabel(server: McpServer): string | undefined {
  const info = server.server.getClientVersion();
  return info ? `${info.name} ${info.version}` : undefined;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse, port: number) {
  if (process.env.SHASHOKU_MCP_DEBUG) {
    const { authorization, ...rest } = req.headers;
    console.log("[mcp:debug]", req.method, req.url, JSON.stringify(rest));
  }
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
  const sessionId = req.headers["mcp-session-id"];
  if (typeof sessionId === "string") {
    const held = transports.get(sessionId);
    if (held) {
      await held.handleRequest(req, res);
      return;
    }
  }
  // No session yet: only an initialize opens one; the transport itself
  // answers anything else with the right protocol error.
  const server: McpServer = buildServer(() => clientLabel(server));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      transports.set(id, transport);
      if (process.env.SHASHOKU_MCP_DEBUG) {
        console.log(
          "[mcp:debug] session",
          id,
          "clientInfo:",
          JSON.stringify(server.server.getClientVersion()),
        );
      }
    },
    // Kills DNS rebinding as a class: a rebound page's request arrives with
    // the attacker's Host and is refused before the token even matters.
    enableDnsRebindingProtection: true,
    allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
  });
  transport.onclose = () => {
    if (transport.sessionId) transports.delete(transport.sessionId);
  };
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
    void handleMcp(req, res, port).catch((err) => {
      console.error("[mcp] request failed", err);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  httpServer.on("error", (err) => {
    console.error("[mcp] server error — MCP endpoint unavailable", err);
  });
  void loadToken()
    .then((held) => {
      token = held;
      httpServer.listen(port, "127.0.0.1", () => {
        console.log(`[mcp] listening on http://127.0.0.1:${port}/mcp`);
        console.log(`[mcp] bearer token: ${token}`);
      });
    })
    .catch((err) => {
      console.error("[mcp] token unavailable — MCP endpoint not started", err);
    });
  return httpServer;
}
