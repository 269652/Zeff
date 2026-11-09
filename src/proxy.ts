import { NextResponse, type NextRequest } from "next/server";
import { EDGE_HEADER, GATE_COOKIE, gateCheck, gateOn, readGate, viaTailnet } from "@/lib/gate";
import { gatePage } from "@/lib/gate-page";
import { lockPage } from "@/lib/lock/page";
import { ACCOUNT_HEADER, accountForHost, accountRoutes, activeAccountNow, lockCookieFor, lockOpenFor, readConfig, readState, sessionValid } from "@/lib/lock/shared";
import { DEFAULT_ACCOUNT_ID, PREFIX_HEADER, refererAccount, splitPrefix } from "@/lib/account-routes";
import { movedPage } from "@/lib/moved-pages";

/** Whether the request is a page load (the address bar, a link, a form) — not a fetch, an RSC request, an EventSource. */
const isDocument = (req: NextRequest) => {
  const dest = req.headers.get("sec-fetch-dest");
  return (dest === "document" || dest === "iframe") && !req.headers.has("rsc") && !req.headers.has("next-action");
};

/**
 * Which account a request is for, and the path it means:
 *   /<slug>/…        that account's (Settings → Accounts: each account's slug) — rewritten to the rest of the path
 *   anything else    the account of its host (data/accounts.json `host`, the fallback), else the first account — unless the
 *                    Referer is a page under another account's prefix: then a page load is sent there (307), and a fetch,
 *                    an RSC request, a Server Action, an EventSource is that account's (the safety net: nothing we forgot to
 *                    prefix lands silently in the wrong account).
 */
/** A sign-in's start and its way back (Google, Microsoft, the connectors): the callback URL is fixed (no prefix), so the start remembers the account. */
const OAUTH_START = /^\/api\/(?:.+\/)?connect$/;
const OAUTH_BACK = /^\/api\/(?:.+\/)?callback$/;
const OAUTH_ACCOUNT_COOKIE = "zeff_oauth_account";

/**
 * A rewrite runs the proxy again for its destination ("/privat/todos" → "/todos"): that second pass keeps what the first one
 * decided — told by a token only this process knows (a header a client sends itself is no account's).
 */
const ROUTED_HEADER = "x-zeff-routed";
const ROUTED = ((globalThis as { __zeffRoutedToken?: string }).__zeffRoutedToken ??= crypto.randomUUID());

function route(req: NextRequest): { account: string | null; prefix: string; rewrite?: URL; redirect?: URL; oauthAccount?: string } {
  if (req.headers.get(ROUTED_HEADER) === ROUTED) return { account: req.headers.get(ACCOUNT_HEADER), prefix: req.headers.get(PREFIX_HEADER) ?? "" };
  const routes = accountRoutes();
  const byHost = accountForHost(req.headers.get("host"));
  if (!routes.installed) return { account: byHost, prefix: "" };
  const url = req.nextUrl;
  const hit = splitPrefix(url.pathname, routes.slugs);
  if (hit) {
    // A page that moved, under the prefix: next.config's redirects ran before us and didn't see it.
    const moved = movedPage(hit.rest, url.search);
    if (moved) return { account: hit.account, prefix: hit.prefix, redirect: new URL(`${hit.prefix}${moved}`, url) };
    // The page itself. Behind the launcher's HTTPS front door Next takes the request for https (X-Forwarded-Proto), and
    // a rewrite there went out to https://localhost:9333 — which only speaks http (a 500, "wrong version number"). Zeff
    // itself always serves plain http (TLS ends at the front door): the rewrite says so.
    const rewrite = url.clone();
    rewrite.pathname = hit.rest;
    rewrite.protocol = "http:";
    return { account: hit.account, prefix: hit.prefix, rewrite, ...(OAUTH_START.test(hit.rest) ? { oauthAccount: hit.account } : {}) };
  }
  // Back from a sign-in: the account it was started in (its cookie, set at the start below).
  if (OAUTH_BACK.test(url.pathname)) {
    const id = req.cookies.get(OAUTH_ACCOUNT_COOKIE)?.value;
    const prefix = id ? routes.prefixes.get(id) : undefined;
    if (id && prefix !== undefined) return { account: id, prefix };
    return { account: byHost ?? DEFAULT_ACCOUNT_ID, prefix: "" };
  }
  if (OAUTH_START.test(url.pathname)) return { account: byHost ?? DEFAULT_ACCOUNT_ID, prefix: "", oauthAccount: byHost ?? DEFAULT_ACCOUNT_ID };
  const via = refererAccount(req.headers.get("referer"), req.headers.get("host"), routes.slugs);
  if (via && via.account !== byHost) {
    if (isDocument(req) && req.method === "GET") return { account: via.account, prefix: via.prefix, redirect: new URL(`${via.prefix}${url.pathname === "/" ? "/" : url.pathname}${url.search}`, url) };
    return { account: via.account, prefix: via.prefix };
  }
  return { account: byHost ?? DEFAULT_ACCOUNT_ID, prefix: "" };
}

/**
 * The lock (Settings → Lock): while it is on and this browser has no live session — the key's PIN and a touch, key still
 * plugged in — every request of a browser gets the lock page (a page load) or a 401 (a fetch, a Server Action). Nothing of
 * Zeff is rendered, nothing is answered.
 *
 * Only a browser is stopped: agents, MCP clients, the launcher and scripts send no Sec-Fetch-* headers (browsers always do,
 * and a page cannot remove them), so they pass — the lock guards the screen, not the machine. /api/lock is the way in.
 */
export function proxy(req: NextRequest) {
  // The account this request is for (see route): set as a header the server reads per request (src/db/accounts.ts) — never
  // the client's own (a forged one is dropped).
  const r = route(req);
  if (r.redirect) return NextResponse.redirect(r.redirect, 307);
  const account = r.account;
  const headers = new Headers(req.headers);
  headers.delete(ACCOUNT_HEADER);
  headers.delete(PREFIX_HEADER);
  headers.delete(ROUTED_HEADER);
  if (account) headers.set(ACCOUNT_HEADER, account);
  headers.set(PREFIX_HEADER, r.prefix);
  if (r.rewrite) headers.set(ROUTED_HEADER, ROUTED);
  const next = () => {
    const res = r.rewrite ? NextResponse.rewrite(r.rewrite, { request: { headers } }) : NextResponse.next({ request: { headers } });
    if (r.oauthAccount) res.cookies.set(OAUTH_ACCOUNT_COOKIE, r.oauthAccount, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
    return res;
  };
  const path = r.rewrite?.pathname ?? req.nextUrl.pathname;
  // On a server (ZEFF_GATE=1): what comes from the internet needs the gate's session or a token first (src/lib/gate.ts) — and so
  // does what comes from your tailnet (the phone, through Tailscale's serve), wherever Zeff runs.
  const tailnet = viaTailnet(req.headers);
  if (gateOn() || tailnet) {
    const g = gateCheck({ edge: tailnet || req.headers.has(EDGE_HEADER), path, cookie: req.cookies.get(GATE_COOKIE)?.value, authorization: req.headers.get("authorization") }, readGate(), Date.now());
    const closed = { "cache-control": "no-store", "x-zeff-locked": "1" };
    if (g === "deny") return new NextResponse("Zeff is closed: no password is set (on this computer: Settings → Mobile access, or scripts/gate.mjs).", { status: 503, headers: closed });
    if (g === "login") {
      const page = req.method === "GET" && (req.headers.get("sec-fetch-dest") ?? "document") === "document";
      if (page) return new NextResponse(gatePage(), { status: 401, headers: { ...closed, "content-type": "text/html; charset=utf-8" } });
      return NextResponse.json({ error: "signed out" }, { status: 401, headers: closed });
    }
  }
  // The widget libraries (public open-source files a sandboxed widget loads — it has no session to show): never locked.
  if (path.startsWith("/api/widgets/lib/")) return next();
  const cfg = readConfig();
  if (!cfg) return next();
  // The private account is not locked (see lockOpenFor): the lock guards the others — the account of this request.
  if (lockOpenFor(cfg, account ?? activeAccountNow())) return next();
  if (path === "/api/lock") return next();
  if (!req.headers.get("sec-fetch-site")) return next();
  // Each account its own session (the first one under the name it always had): unlocking one doesn't unlock another.
  if (sessionValid(req.cookies.get(lockCookieFor(account ?? activeAccountNow()))?.value, cfg, readState(), Date.now())) return next();
  const dest = req.headers.get("sec-fetch-dest");
  const locked = { "cache-control": "no-store", "x-zeff-locked": "1" };
  if (req.method === "GET" && (dest === "document" || dest === "iframe")) return new NextResponse(lockPage(), { status: 401, headers: { ...locked, "content-type": "text/html; charset=utf-8" } });
  return NextResponse.json({ error: "locked", message: "Zeff is locked: unlock it with the security key." }, { status: 401, headers: locked });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
