"use strict";

/**
 * Whether the window answers, asked through the door the application already
 * has rather than one opened for the test.
 *
 * `[mcp] listening` is printed before the window is built, and a renderer that
 * dies leaves the main process running — so the line that the app check waits
 * for says the main process reached one statement and nothing more. A tool call
 * has to travel main → BrowserWindow → preload → renderer bundle → Vue before
 * anything can come back, which is the chain assembling a package is supposed
 * to produce.
 *
 * The root mount is inside that: the renderer only says it can answer once
 * `app.mount` has returned, and the bridge holds the call until it hears that.
 * A component that throws on the way up therefore never releases this.
 *
 * ⚠️ It reaches the mount and stops there. Whether what mounted goes on
 * behaving — an effect that fails later, a view nobody can use — is a question
 * for an instrument that drives the interface.
 *
 * The transport is spoken by hand because this runs with no `node_modules` to
 * take the SDK from.
 */

const endpoint = process.env.SHASHOKU_MCP_ENDPOINT;
const token = process.env.SHASHOKU_MCP_TOKEN;

/**
 * The sentence only the renderer can produce. It is thrown by the answer
 * dispatch when no project is open, which means reaching it needed the preload
 * bridge, the renderer bundle and a live Pinia — and no part of the main
 * process can say it. An error is the expected answer here: the check starts
 * the application with nothing open.
 *
 * ⚠️ Asserting on wording, which the repository treats as translatable. When
 * that string is given a locale this check goes red while the application is
 * fine, and the answer then is a stable code beside the wording rather than a
 * second copy of the sentence here.
 */
const FROM_THE_RENDERER = "沒有開啟中的專案";

let session = null;
let protocol = null;

/** One message each way. The transport answers in SSE unless asked otherwise. */
function decode(body) {
  if (body === "") return null;
  const line = body.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice("data:".length) : body);
}

async function rpc(message) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };
  if (session !== null) headers["mcp-session-id"] = session;
  if (protocol !== null) headers["mcp-protocol-version"] = protocol;

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`${message.method}: HTTP ${res.status} ${body}`);
  }
  const held = res.headers.get("mcp-session-id");
  if (held !== null) session = held;
  return decode(body);
}

function fail(why) {
  console.error(`renderer check: ${why}`);
  process.exit(1);
}

async function main() {
  if (!endpoint || !token) fail("SHASHOKU_MCP_ENDPOINT and SHASHOKU_MCP_TOKEN are required");

  const opened = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "shashoku-renderer-check", version: "0" },
    },
  });
  if (opened === null || opened.error) fail(`initialize refused: ${JSON.stringify(opened)}`);
  protocol = opened.result.protocolVersion;
  if (session === null) fail("no session id came back from initialize");

  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });

  // Read-only, and the one tool that cannot be answered without the window.
  const answered = await rpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "get_texts", arguments: {} },
  });
  if (answered === null || answered.error) fail(`tools/call refused: ${JSON.stringify(answered)}`);

  const said = (answered.result.content ?? [])
    .map((part) => part.text ?? "")
    .join("\n");

  // The three ways the bridge reports that nothing came back, named so a
  // failure here says which one happened rather than only that the text was
  // wrong.
  if (said.includes("still starting up")) fail("the interface never finished mounting");
  if (said.includes("renderer did not answer in time")) fail("the window never answered");
  if (said.includes("Shashoku window is not open")) fail("no window was there to ask");
  if (!said.includes(FROM_THE_RENDERER)) {
    fail(`answered, but not from the renderer: ${JSON.stringify(said)}`);
  }

  console.log("renderer check: the window answered");
}

main().catch((err) => fail(String(err)));
