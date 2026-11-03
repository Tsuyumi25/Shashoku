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
  noteRefs,
  noteSeen,
  renderChooseResult,
  renderProposeResult,
  renderTexts,
  renderWithdrawResult,
  seenIdsFor,
  sinceSeen,
  type RefMemory,
  type SeenTexts,
} from "@shared/mcp/render";
import type {
  ChooseOutcome,
  ChooseParams,
  GetTextsParams,
  PageTexts,
  ProposeOutcome,
  ProposeParams,
  WithdrawOutcome,
  WithdrawParams,
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
  // Per session, as the server is: "changed since the last read" means since
  // this caller's last read, and a reconnect starts with nothing seen.
  const seen: SeenTexts = new Map();
  /**
   * Which object every address this session was shown stood for. Nothing in
   * the project records that a page was regrouped, so this is the whole of
   * how a write quoting a number from before it is caught.
   */
  const refs: RefMemory = new Map();

  const GRAMMAR =
    "Addresses are short and permanent: `p7/14` is sentence 14 of the face being read and " +
    "stands for its block of lettering where it has exactly one, `p7/14.2` is that " +
    "sentence's block 2, `p7/14.2b` is candidate b in that block's drawer, and `p7/14b` is " +
    "the same where the sentence has one block. `p7` is the page's id. Numbers are never " +
    "reused, so an address either still names what you were shown or is refused — it never " +
    "quietly comes to mean something else. face names the face the call's addresses " +
    "resolve in (`f1`, `f2`, … as get_texts' headers show them); without it, the face the " +
    "person is working on. An address may carry its face itself — `p7/f2/14.2` — and then " +
    "means that face whatever face the call names; an address a person copies from the " +
    "app is always written this way.";

  server.registerTool(
    "get_texts",
    {
      title: "Read sentences' source and translation, by address",
      description:
        "Read-only. Lists the open Shashoku project page by page and, within a page, one " +
        "section per translation face (譯文, English, …) named as the person named it. A " +
        "section's header reads `第 3 頁 · p7 · 001.jpg · f1 譯文 · 19 句`: where the page " +
        "reads in the chapter, its id, its name, the face, and how many sentences it holds. " +
        "Under it each sentence is listed in reading order under its number — `14  原文 …` " +
        "is the artwork's words, each block of them under `s<n>`, `譯文` is what the whole " +
        "sentence reads as today, and `候選` is the drawer, each candidate under a letter " +
        "with `✓` on the one in effect. An empty 譯文 means the sentence is untranslated. " +
        "A sentence set in several blocks of lettering lists each block on its own line as " +
        "`14.2 <text>  候選 …`; the blocks are read as one sentence with `/` between them. " +
        GRAMMAR +
        " page_ids reads only those pages; face reads only that face. changed_only answers " +
        "only the sentences that read differently since this session last saw them — " +
        "through get_texts or any write's reply — plus the addresses that are gone; the " +
        "first read of a session is all of it. 原文 and 譯文 are markup: " +
        "`<size=×1.3 color=#ff0000 weight=+1 upright>…</>` sets one stretch apart, and a " +
        "literal `<` or `&` is written `&lt;` or `&amp;`. Keep the tags you are given. A " +
        "line break inside one block is shown as `⏎`. Candidates are marked （human） for a " +
        "person's, （你） for yours and （AI） for another client's.",
      inputSchema: {
        page_ids: z.array(z.string()).min(1).optional(),
        face: z.string().optional(),
        changed_only: z.boolean().optional(),
      },
    },
    async ({ page_ids, face, changed_only }) => {
      try {
        const pages = await askRenderer<PageTexts[]>("get_texts", {
          pageIds: page_ids,
          face,
        } satisfies GetTextsParams);
        const caller = getSource();
        const missing = page_ids?.filter((id) => !pages.some((p) => p.pageId === id)) ?? [];
        const since = changed_only ? sinceSeen(seen, pages, caller) : null;
        noteSeen(seen, pages, caller, true);
        noteRefs(refs, pages);
        const text = renderTexts(since?.pages ?? pages, {
          caller,
          missing,
          changedOnly: since?.gone,
        });
        return { content: [{ type: "text", text }] };
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
        "Append translation candidates, on any number of pages in one batch. Never deletes: " +
        "every item lands in a block of lettering's candidate drawer. Where that block " +
        "currently reads as nothing at all, the new candidate also takes effect immediately; " +
        "anywhere else it stays in the drawer unless the item sets choose, which makes it " +
        "take effect whatever the block read as (the earlier choice stays in the drawer). " +
        GRAMMAR +
        " ref names a sentence (`p7/14`) or one block of it (`p7/14.2`), never a candidate — " +
        "`p7/14b` is refused. A sentence set in several blocks is refused by its sentence " +
        "address, and the refusal names the block addresses to use instead. ⚠️ Before " +
        "proposing into one block of such a sentence, read the whole sentence's 原文 and the " +
        "other blocks' current text, both of which get_texts gives you: the blocks are read " +
        "together as one sentence with `/` between them, so a block translated without the " +
        "rest in view will not read as part of it. lines is one array entry per rendered " +
        "line of that one block — no embedded newlines. Lines are markup, the same syntax " +
        "get_texts shows: wrap a stretch in " +
        "`<size=×1.3 color=#ff0000 weight=+1 upright>…</>` to set it apart, and write a " +
        "literal `<` or `&` as `&lt;` or `&amp;`. Replies with each touched sentence in the " +
        "same form get_texts uses, so you can keep going without reading again.",
      inputSchema: {
        face: z.string().optional(),
        items: z
          .array(
            z.object({
              ref: z.string(),
              lines: z.array(z.string()).min(1),
              choose: z.boolean().optional(),
            }),
          )
          .min(1),
      },
    },
    async ({ face, items }) => {
      try {
        const caller = getSource();
        const result = await askRenderer<WriteResult<ProposeOutcome>>("propose_translations", {
          face,
          items: items.map((i) => ({
            ref: i.ref,
            lines: i.lines,
            choose: i.choose,
            seen: seenIdsFor(refs, i.ref),
          })),
          source: caller,
        } satisfies ProposeParams);
        noteSeen(seen, result.pages, caller, false);
        noteRefs(refs, result.pages);
        return { content: [{ type: "text", text: renderProposeResult(result, caller) }] };
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
        "Remove translation candidates from a block of lettering's drawer, on any number of " +
        "pages in one batch. Only candidates this client itself proposed (marked （你）) can " +
        "be withdrawn: human-written candidates and other clients' proposals are refused per " +
        "item. Withdrawing a current choice falls that block back to its own typed lines. " +
        GRAMMAR +
        " ref names a candidate — `p7/14b` where the sentence has one block, `p7/14.2b` " +
        "otherwise. A sentence or block address is refused: add the candidate's letter. " +
        "Every candidate is a row on the person's screen beside the page, so withdraw your " +
        "own once a newer one replaces it or it is plainly not wanted. Replies with each " +
        "touched sentence's full state afterwards.",
      inputSchema: {
        face: z.string().optional(),
        items: z.array(z.object({ ref: z.string() })).min(1),
      },
    },
    async ({ face, items }) => {
      try {
        const caller = getSource();
        const result = await askRenderer<WriteResult<WithdrawOutcome>>("withdraw_translation", {
          face,
          items: items.map((i) => ({ ref: i.ref, seen: seenIdsFor(refs, i.ref) })),
          source: caller,
        } satisfies WithdrawParams);
        noteSeen(seen, result.pages, caller, false);
        noteRefs(refs, result.pages);
        return { content: [{ type: "text", text: renderWithdrawResult(result, caller) }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "choose_translation",
    {
      title: "Point blocks of lettering at candidates in their drawers",
      description:
        "Move a block of lettering's translation slot to a candidate already in its drawer, " +
        "on any number of pages in one batch. Nothing is deleted: the previous choices stay " +
        "in the drawers. " +
        GRAMMAR +
        " ref names a candidate — `p7/14b` where the sentence has one block, `p7/14.2b` " +
        "otherwise, the letters being the ones get_texts lists in that block's drawer. A " +
        "sentence or block address is refused: add the candidate's letter. Replies with each " +
        "touched sentence's full state afterwards.",
      inputSchema: {
        face: z.string().optional(),
        items: z.array(z.object({ ref: z.string() })).min(1),
      },
    },
    async ({ face, items }) => {
      try {
        const caller = getSource();
        const result = await askRenderer<WriteResult<ChooseOutcome>>("choose_translation", {
          face,
          items: items.map((i) => ({ ref: i.ref, seen: seenIdsFor(refs, i.ref) })),
        } satisfies ChooseParams);
        noteSeen(seen, result.pages, caller, false);
        noteRefs(refs, result.pages);
        return { content: [{ type: "text", text: renderChooseResult(result, caller) }] };
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
  const wanted = Number(process.env.SHASHOKU_MCP_PORT ?? DEFAULT_PORT);
  /**
   * Where it actually listens, which is only the same number when one was
   * asked for. Port 0 means "whichever is free", and the rebinding guard
   * compares the Host header against this — told the 0, it would refuse every
   * request that ever arrived. Read inside the listen callback, so it is
   * settled before any request can reach the handler below.
   */
  let bound = wanted;
  const httpServer = createServer((req, res) => {
    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404).end();
      return;
    }
    void handleMcp(req, res, bound).catch((err) => {
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
      httpServer.listen(wanted, "127.0.0.1", () => {
        const address = httpServer.address();
        if (address !== null && typeof address !== "string") bound = address.port;
        console.log(`[mcp] listening on http://127.0.0.1:${bound}/mcp`);
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
