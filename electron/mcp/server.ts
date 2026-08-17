import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { askRenderer } from "./bridge";
import {
  renderChooseResult,
  renderProposeResult,
  renderTexts,
  renderWithdrawResult,
} from "@shared/mcp/render";
import type {
  ChooseOutcome,
  PageTexts,
  ProposeOutcome,
  WithdrawOutcome,
  WriteResult,
} from "@shared/mcp/types";

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

function authenticates(header: string | string[] | undefined): boolean {
  if (token === "" || typeof header !== "string") return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const held = Buffer.from(header);
  return held.length === expected.length && timingSafeEqual(held, expected);
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
        const result = await askRenderer<WriteResult<ProposeOutcome>>("propose_translations", {
          pageId: page_id,
          items: items.map((i) => ({ objectId: i.object_id, lines: i.lines })),
          source: getSource(),
        });
        return { content: [{ type: "text", text: renderProposeResult(result) }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "withdraw_translation",
    {
      title: "Withdraw candidates this client proposed",
      description:
        "Remove translation candidates from objects' drawers, in one batch. Only " +
        "candidates this client itself proposed can be withdrawn: human-written " +
        "candidates and other clients' proposals are refused per item. Withdrawing a " +
        "current choice falls that object back to its own typed lines. Replies with " +
        "each object's full state afterwards.",
      inputSchema: {
        page_id: z.string(),
        items: z
          .array(z.object({ object_id: z.string(), translation_id: z.string() }))
          .min(1),
      },
    },
    async ({ page_id, items }) => {
      try {
        const result = await askRenderer<WriteResult<WithdrawOutcome>>("withdraw_translation", {
          pageId: page_id,
          items: items.map((i) => ({ objectId: i.object_id, translationId: i.translation_id })),
          source: getSource(),
        });
        return { content: [{ type: "text", text: renderWithdrawResult(result) }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "choose_translation",
    {
      title: "Point objects at candidates in their drawers",
      description:
        "Move text objects' translation slots to candidates already in their drawers " +
        "(candidate ids are listed by get_texts), in one batch. Nothing is deleted: the " +
        "previous choices stay in the drawers. Replies with each object's full state " +
        "afterwards.",
      inputSchema: {
        page_id: z.string(),
        items: z
          .array(z.object({ object_id: z.string(), translation_id: z.string() }))
          .min(1),
      },
    },
    async ({ page_id, items }) => {
      try {
        const result = await askRenderer<WriteResult<ChooseOutcome>>("choose_translation", {
          pageId: page_id,
          items: items.map((i) => ({ objectId: i.object_id, translationId: i.translation_id })),
        });
        return { content: [{ type: "text", text: renderChooseResult(result) }] };
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
 *
 * They also have to be reaped here: the SDK fires onclose only on an explicit
 * DELETE, and a CLI agent invoked once per task just terminates — without the
 * sweep every such run would stay in this map for the life of the process.
 */
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; lastSeen: number }>();

const SESSION_IDLE_MS = 30 * 60 * 1000;

function reapIdleSessions() {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [id, held] of sessions) {
    if (held.lastSeen < cutoff) {
      sessions.delete(id);
      void held.transport.close();
    }
  }
}

function clientLabel(server: McpServer): string | undefined {
  const info = server.server.getClientVersion();
  return info ? `${info.name} ${info.version}` : undefined;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse, port: number) {
  if (process.env.SHASHOKU_MCP_DEBUG) {
    const { authorization, ...rest } = req.headers;
    console.log("[mcp:debug]", req.method, req.url, JSON.stringify(rest));
  }
  if (!authenticates(req.headers.authorization)) {
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
    const held = sessions.get(sessionId);
    if (held) {
      held.lastSeen = Date.now();
      await held.transport.handleRequest(req, res);
      return;
    }
    // A session id we no longer hold was reaped (or the app restarted).
    // 404 is the spec's word for it: the client re-initializes on its own.
    res.writeHead(404, { "content-type": "application/json" }).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: "session not found: re-initialize" },
        id: null,
      }),
    );
    return;
  }
  // No session yet: only an initialize opens one; the transport itself
  // answers anything else with the right protocol error.
  const server: McpServer = buildServer(() => clientLabel(server));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { transport, lastSeen: Date.now() });
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
    if (transport.sessionId) sessions.delete(transport.sessionId);
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
  setInterval(reapIdleSessions, 5 * 60 * 1000).unref();
  void loadToken()
    .then((held) => {
      token = held;
      httpServer.listen(port, "127.0.0.1", () => {
        console.log(`[mcp] listening on http://127.0.0.1:${port}/mcp`);
        const home = process.env.SHASHOKU_MCP_TOKEN
          ? "env SHASHOKU_MCP_TOKEN"
          : join(app.getPath("userData"), "mcp-token");
        console.log(`[mcp] bearer token in ${home}`);
      });
    })
    .catch((err) => {
      console.error("[mcp] token unavailable — MCP endpoint not started", err);
    });
  return httpServer;
}
