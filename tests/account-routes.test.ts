import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { setupTempData } from "./helpers";

// One route per account: "/privat/…" is that account's Zeff, the unprefixed URLs the first account's ("/standard/…" an alias).
setupTempData();

test("a path under an account's prefix names it; the rest is the page; Zeff's own segments are no account's", async () => {
  const { slugMap, splitPrefix, withPrefix, stripPrefix, refererAccount, prefixOf } = await import("@/lib/account-routes");
  const slugs = slugMap([{ id: "default" }, { id: "privat" }, { id: "verein-2", slug: "verein" }]);
  assert.deepEqual(splitPrefix("/privat/workspace/262", slugs), { account: "privat", slug: "privat", prefix: "/privat", rest: "/workspace/262" });
  assert.equal(splitPrefix("/privat", slugs)?.rest, "/");
  assert.equal(splitPrefix("/Verein/todos", slugs)?.account, "verein-2");
  assert.equal(splitPrefix("/standard/todos", slugs)?.account, "default");
  assert.equal(splitPrefix("/workspace/262", slugs), null);
  assert.equal(splitPrefix("/verein-2/todos", slugs), null, "an account with a slug of its own isn't under its id");
  assert.equal(prefixOf({ id: "default" }), "");
  assert.equal(prefixOf({ id: "verein-2", slug: "verein" }), "/verein");

  assert.equal(withPrefix("/privat", "/todos?x=1#a"), "/privat/todos?x=1#a");
  assert.equal(withPrefix("/privat", "/"), "/privat/");
  assert.equal(withPrefix("/privat", "/privat/todos"), "/privat/todos", "not twice");
  assert.equal(withPrefix("/privat", "/privatsachen"), "/privat/privatsachen", "a page that only starts like the prefix");
  for (const href of ["https://x.org/a", "//evil.org/a", "#top", "?q=1", "mailto:a@b.c", "todos", "/_next/static/x.js"]) assert.equal(withPrefix("/privat", href), href);
  assert.equal(withPrefix("", "/todos"), "/todos");
  assert.equal(stripPrefix("/privat", "/privat/todos"), "/todos");
  assert.equal(stripPrefix("/privat", "/privat"), "/");

  assert.deepEqual(refererAccount("http://localhost:9333/privat/todos", "localhost:9333", slugs), { account: "privat", prefix: "/privat" });
  assert.equal(refererAccount("http://localhost:9333/todos", "localhost:9333", slugs), null);
  assert.equal(refererAccount("http://evil.org/privat/todos", "localhost:9333", slugs), null, "another origin's Referer names nothing");
  assert.equal(refererAccount("http://localhost:9333/standard/todos", "localhost:9333", slugs), null, "the first account is unprefixed anyway");
});

test("an account's route is checked: the pattern, Zeff's own pages, another account's", async () => {
  const { addAccount, setAccountsInstalled, updateAccount } = await import("@/db/accounts");
  const { accountRoutes } = await import("@/lib/lock/shared");
  setAccountsInstalled(true);
  const privat = addAccount("Privat", "emerald");
  const verein = addAccount("Verein", "amber");
  assert.equal(updateAccount(verein.id, { slug: " /Klub/ " }).slug, "klub");
  assert.throws(() => updateAccount(privat.id, { slug: "klub" }), /route of another account/);
  assert.throws(() => updateAccount(privat.id, { slug: "workspace" }), /Zeff's own pages/);
  assert.throws(() => updateAccount(privat.id, { slug: "api" }), /Zeff's own pages/);
  assert.throws(() => updateAccount(privat.id, { slug: "Not valid!" }), /can't be a route/);
  assert.equal(updateAccount(verein.id, { slug: "" }).slug, undefined, "empty: its id again");
  await new Promise((r) => setTimeout(r, 1100)); // the proxy's short cache
  const routes = accountRoutes();
  assert.equal(routes.slugs.get(privat.id), privat.id);
  assert.equal(routes.slugs.get("standard"), "default");
  assert.equal(routes.prefixes.get("default"), "");
  assert.equal(routes.prefixes.get(verein.id), `/${verein.id}`);
});

test("a moved page under a prefix goes where the unprefixed one goes, its query along", async () => {
  const { movedPage } = await import("@/lib/moved-pages");
  assert.equal(movedPage("/tickets", "?ticket=3"), "/todos?part=tickets&ticket=3");
  assert.equal(movedPage("/apps/whatsapp", "?chat=wa:123"), "/mail?channel=whatsapp&open=wa%3A123&chat=wa%3A123");
  assert.equal(movedPage("/review/", ""), "/heute#review");
  assert.equal(movedPage("/todos", ""), null);
});

test("the browser keeps the prefix: fetch, EventSource, history, links — not other origins or Next's files", async () => {
  const { accountNavScript } = await import("@/lib/account-nav-script");
  const fetched: unknown[] = [];
  const pushed: unknown[] = [];
  const opened: unknown[] = [];
  const listeners: Record<string, (e: unknown) => void> = {};
  class FakeEventSource {
    url: string;
    constructor(url: string) {
      this.url = url;
    }
  }
  const win: Record<string, unknown> = {
    location: { origin: "http://localhost:9333" },
    fetch: (i: unknown) => (fetched.push(i), Promise.resolve()),
    EventSource: FakeEventSource,
    open: (u: unknown) => opened.push(u),
  };
  const history = { pushState: (_s: unknown, _t: unknown, u: unknown) => pushed.push(u), replaceState: (_s: unknown, _t: unknown, u: unknown) => pushed.push(u) };
  const document = { addEventListener: (k: string, f: (e: unknown) => void) => (listeners[k] = f) };
  const ctx = vm.createContext({ window: win, location: win.location, history, document, URL, Request: class {} });
  vm.runInContext(accountNavScript("/privat"), ctx);
  const w = win as { fetch(i: unknown): void; EventSource: new (u: string) => FakeEventSource; open(u: string): void };
  w.fetch("/api/sync");
  w.fetch("http://localhost:9333/todos?_rsc=1");
  w.fetch(new URL("http://localhost:9333/todos"));
  w.fetch("https://other.org/api");
  w.fetch("/_next/static/chunk.js");
  w.fetch("/privat/api/x");
  assert.deepEqual(fetched.map(String), ["/privat/api/sync", "http://localhost:9333/privat/todos?_rsc=1", "http://localhost:9333/privat/todos", "https://other.org/api", "/_next/static/chunk.js", "/privat/api/x"]);
  assert.equal(new w.EventSource("/api/events").url, "/privat/api/events");
  history.pushState(null, "", "/todos");
  history.replaceState(null, "", null);
  assert.deepEqual(pushed, ["/privat/todos", null]);
  w.open("/t/37");
  assert.deepEqual(opened, ["/privat/t/37"]);
  // A plain link: its href gets the prefix as it is clicked.
  let href = "/workspace";
  const a = { getAttribute: () => href, setAttribute: (_: string, v: string) => (href = v) };
  listeners.click({ target: { closest: () => a } });
  assert.equal(href, "/privat/workspace");
  // Unprefixed pages: nothing patched.
  const plain: Record<string, unknown> = { location: { origin: "x" }, fetch: () => 1 };
  const before = plain.fetch;
  vm.runInContext(accountNavScript(""), vm.createContext({ window: plain, location: plain.location, history: {}, document: {}, URL }));
  assert.equal(plain.fetch, before);
});
