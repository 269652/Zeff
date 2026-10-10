// The HTTPS front door: terminates TLS on 127.0.0.1 and passes each request to the Next server
// its Host names — knowledge.<host> → the knowledge server, anything else → Zeff. The Host header
// is kept and X-Forwarded-Proto/Host/For are set, so Next builds https URLs and its Server
// Actions origin check sees the browser's own origin. Streaming responses (live logs, SSE) pass
// through as they come; WebSocket upgrades are tunnelled.
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const { log } = require("./log");

const HOP_BY_HOP = ["connection", "keep-alive", "proxy-connection", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];

const hostOnly = (h) => (h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0]);

function stripHopByHop(headers) {
  const out = { ...headers };
  for (const n of String(headers.connection ?? "").split(","))
    if (n.trim()) delete out[n.trim().toLowerCase()];
  for (const n of HOP_BY_HOP) delete out[n];
  return out;
}

function forwarded(req, listenPort) {
  const h = stripHopByHop(req.headers);
  if (req.headers.host) h["x-forwarded-host"] = req.headers.host;
  h["x-forwarded-proto"] = "https";
  h["x-forwarded-port"] = String(listenPort);
  const ip = req.socket.remoteAddress ?? "";
  h["x-forwarded-for"] = req.headers["x-forwarded-for"] ? `${req.headers["x-forwarded-for"]}, ${ip}` : ip;
  return h;
}

/**
 * Next builds `request.url` from its own bind address (`http(s)://localhost:9333/…`), not the
 * Host header — so an absolute redirect made from it points at the backend. Point it back at
 * the address the browser used.
 */
function rewriteLocation(location, backendPort, hostHeader) {
  if (!location || !hostHeader) return location;
  const m = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):(\d+)(?=$|[/?#])/.exec(location);
  return m && Number(m[2]) === backendPort ? `https://${hostHeader}${location.slice(m[0].length)}` : location;
}

function page(res, status, title, text, retry) {
  const html = `<!doctype html><html><head><meta charset="utf-8">${retry ? '<meta http-equiv="refresh" content="2">' : ""}<title>${title}</title>
<style>body{font:16px system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 1rem;color:#222;background:#fafafa}
@media(prefers-color-scheme:dark){body{color:#ddd;background:#18181b}}h1{font-size:1.4rem}p{opacity:.75}</style>
</head><body><h1>${title}</h1><p>${text}</p></body></html>`;
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(html);
}

/** tls: the certificate's options (tls.ensure); routes: { knowledgeHost?, zeffPort, knowledgePort } */
function createHttpsServer({ tls, routes, listenPort }) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
  const backend = (hostHeader) => {
    const host = hostOnly(hostHeader ?? "").toLowerCase();
    const k = routes.knowledgeHost;
    return k && (host === k || host === `${k}.localhost`)
      ? { port: routes.knowledgePort, name: "The knowledge server" }
      : { port: routes.zeffPort, name: "Zeff" };
  };

  const server = https.createServer({ ...tls, minVersion: "TLSv1.2" }, (req, res) => {
    const { port, name } = backend(req.headers.host);
    const up = http.request(
      { host: "127.0.0.1", port, method: req.method, path: req.url, headers: forwarded(req, listenPort), agent },
      (r) => {
        const headers = stripHopByHop(r.headers);
        if (headers.location) headers.location = rewriteLocation(headers.location, port, req.headers.host);
        res.writeHead(r.statusCode ?? 502, r.statusMessage, headers);
        r.pipe(res);
      },
    );
    up.on("error", (e) => {
      if (res.headersSent) return res.destroy();
      log(`proxy → 127.0.0.1:${port}${req.url}: ${e.code ?? e.message}`);
      page(
        res,
        502,
        `${name} is starting…`,
        `${name} isn't answering on 127.0.0.1:${port} yet. This page retries by itself; if it stays, open the Zeff tray icon.`,
        true,
      );
    });
    res.on("close", () => {
      if (!res.writableFinished) up.destroy();
    });
    req.pipe(up);
  });

  server.on("upgrade", (req, socket, head) => {
    const { port } = backend(req.headers.host);
    const headers = { ...forwarded(req, listenPort), connection: "Upgrade", upgrade: req.headers.upgrade };
    const up = net.connect(port, "127.0.0.1", () => {
      const lines = Object.entries(headers).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}: ${x}`));
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`);
      if (head?.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    const close = () => {
      up.destroy();
      socket.destroy();
    };
    up.on("error", close);
    socket.on("error", close);
  });

  server.headersTimeout = 60_000;
  server.requestTimeout = 0; // long uploads and streams
  server.keepAliveTimeout = 30_000;
  return server;
}

/** Plain http on port 80 → the same URL on https (`httpsPort` when it isn't 443). */
function createRedirectServer(httpsPort) {
  return http.createServer((req, res) => {
    const host = hostOnly(req.headers.host ?? "zeff");
    res.writeHead(308, { location: `https://${host}${httpsPort === 443 ? "" : `:${httpsPort}`}${req.url}` });
    res.end();
  });
}

/** Resolves true when listening, false when the port is taken (or otherwise unavailable). */
const listen = (server, port, host) =>
  new Promise((resolve) => {
    const onError = (e) => {
      log(`${host}:${port}: ${e.code ?? e.message} — skipped`);
      resolve(false);
    };
    server.once("error", onError);
    server.listen({ port, host, exclusive: true }, () => {
      server.off("error", onError);
      resolve(true);
    });
  });

module.exports = { createHttpsServer, createRedirectServer, listen, rewriteLocation };
