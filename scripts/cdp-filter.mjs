/**
 * A CDP filter for the automation Chrome: Playwright's connectOverCDP attaches to EVERY open tab and
 * waits for each, so one hung tab (frozen renderer, a dialog nobody answers) stops every driver. This
 * is a tiny local proxy between Playwright and Chrome's browser endpoint that leaves the hung tabs
 * out: Playwright never hears of them — no attach, no events, no entry in the target list — and so
 * has nothing to wait for. Nothing is closed or changed in them.
 *
 *   const proxy = await startCdpFilter(browserWsUrl, new Set([hungTargetId]));
 *   const browser = await chromium.connectOverCDP(proxy.endpoint);   // … proxy.close() after
 *
 * Playwright's own bundled `ws` does the sockets (the package isn't ours to add). Null when that
 * isn't there (another Playwright): the caller then does what it did before.
 */
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function sockets() {
  try {
    const u = require("playwright-core/lib/utilsBundle");
    return typeof u.wsServer === "function" && typeof u.ws === "function" ? { Server: u.wsServer, Client: u.ws } : null;
  } catch {
    return null;
  }
}

/**
 * What Playwright may see of what Chrome says: the messages about hidden targets (and their sessions)
 * are dropped, the target list is cut. `state.getTargets` holds the ids of the client's own
 * Target.getTargets requests, whose answers are filtered. Returns the message to forward, or null.
 * Pure — the proxy's whole logic, so it's tested without a browser.
 */
export function fromChrome(msg, hidden, state) {
  const sessions = (state.hiddenSessions ??= new Set());
  if (msg.sessionId && sessions.has(msg.sessionId)) return null;
  const info = msg.params?.targetInfo;
  switch (msg.method) {
    case "Target.attachedToTarget":
      if (info && hidden.has(info.targetId)) {
        if (msg.params.sessionId) sessions.add(msg.params.sessionId);
        return null;
      }
      return msg;
    case "Target.targetCreated":
    case "Target.targetInfoChanged":
      return info && hidden.has(info.targetId) ? null : msg;
    case "Target.targetDestroyed":
    case "Target.targetCrashed":
      return hidden.has(msg.params?.targetId) ? null : msg;
    case "Target.detachedFromTarget":
      if (msg.params?.sessionId && sessions.has(msg.params.sessionId)) return null;
      return msg;
    default:
  }
  if (msg.id !== undefined && state.getTargets?.has(msg.id)) {
    state.getTargets.delete(msg.id);
    if (msg.result?.targetInfos) return { ...msg, result: { ...msg.result, targetInfos: msg.result.targetInfos.filter((t) => !hidden.has(t.targetId)) } };
  }
  return msg;
}

/** Notes Playwright's Target.getTargets requests (their answers are filtered). */
export function fromClient(msg, state) {
  if (msg.method === "Target.getTargets" && msg.id !== undefined) (state.getTargets ??= new Set()).add(msg.id);
  return msg;
}

/** @returns {Promise<{ endpoint: string, close(): void } | null>} */
export async function startCdpFilter(browserWsUrl, hidden) {
  const ws = sockets();
  if (!ws) return null;
  const server = http.createServer();
  const wss = new ws.Server({ server });
  const open = new Set();
  wss.on("connection", (client) => {
    const state = {};
    const upstream = new ws.Client(browserWsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    open.add(client).add(upstream);
    const queue = [];
    upstream.on("open", () => {
      for (const m of queue.splice(0)) upstream.send(m);
    });
    client.on("message", (data) => {
      const text = String(data);
      try {
        fromClient(JSON.parse(text), state);
      } catch {
        // not JSON: forwarded as it is
      }
      if (upstream.readyState === 1) upstream.send(text);
      else queue.push(text);
    });
    upstream.on("message", (data) => {
      const text = String(data);
      let out = text;
      try {
        const m = fromChrome(JSON.parse(text), hidden, state);
        if (!m) return;
        out = JSON.stringify(m);
      } catch {
        // as it is
      }
      if (client.readyState === 1) client.send(out);
    });
    const end = () => {
      for (const s of [client, upstream]) {
        try {
          s.close();
        } catch {
          // already closed
        }
        open.delete(s);
      }
    };
    client.on("close", end);
    upstream.on("close", end);
    client.on("error", end);
    upstream.on("error", end);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    endpoint: `ws://127.0.0.1:${port}/`,
    close() {
      for (const s of open) {
        try {
          s.terminate?.();
        } catch {
          // gone
        }
      }
      try {
        wss.close();
      } catch {
        // closed
      }
      server.close();
    },
  };
}
