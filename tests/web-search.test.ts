import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The Web search plugin: web_search through an official search API (Google Programmable Search, or Brave) — not by
 * scraping — and web_fetch, a page read as text. Both for the MCP server and the Workspace chat; a fetch never goes to the
 * machine's own network (an AI steered by a page could otherwise read Zeff's local pages).
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("webSearch: Google Programmable Search and Brave, mapped to title/url/snippet; no key: a clear error", async () => {
  const s = await import("@/plugins/web-search/search");
  await assert.rejects(s.webSearch("gpt pricing"), /not set up/i, "no key yet");

  s.saveSearchConfig({ provider: "google", googleKey: "KEY", googleCx: "CX" });
  let url = "";
  const google = async (u: string | URL | Request) => ((url = String(u)), json({ items: [{ title: "OpenAI Pricing", link: "https://openai.com/api/pricing/", snippet: "Input $2.50 / 1M tokens" }, { title: "x", link: "javascript:alert(1)", snippet: "" }] }));
  const hits = await s.webSearch("gpt pricing", { count: 3, site: "openai.com" }, { fetch: google as never });
  assert.deepEqual(hits, [{ title: "OpenAI Pricing", url: "https://openai.com/api/pricing/", snippet: "Input $2.50 / 1M tokens" }], "only http(s) links");
  assert.match(url, /customsearch\/v1\?/);
  assert.match(url, /key=KEY/);
  assert.match(url, /cx=CX/);
  assert.match(url, /num=3/);
  assert.match(decodeURIComponent(url).replace(/\+/g, " "), /q=gpt pricing site:openai\.com/);

  s.saveSearchConfig({ provider: "brave", braveKey: "BKEY" });
  let headers: Record<string, string> = {};
  const brave = async (u: string | URL | Request, init?: RequestInit) => ((headers = (init?.headers ?? {}) as Record<string, string>), json({ web: { results: [{ title: "Claude pricing", url: "https://www.anthropic.com/pricing", description: "Input $3 / Output $15" }] } }));
  const b = await s.webSearch("claude pricing", {}, { fetch: brave as never });
  assert.deepEqual(b, [{ title: "Claude pricing", url: "https://www.anthropic.com/pricing", snippet: "Input $3 / Output $15" }]);
  assert.equal(headers["X-Subscription-Token"], "BKEY");

  await assert.rejects(s.webSearch("x", {}, { fetch: (async () => json({ error: { message: "Quota exceeded" } }, 429)) as never }), /Quota exceeded|429/);
  assert.equal(s.getSearchConfig().googleKey, "KEY", "the Google key stays when only Brave was set");
});

test("webFetch: a page as text (no scripts, styles), cut to size; never the machine's own network", async () => {
  const s = await import("@/plugins/web-search/search");
  const page = '<html><head><title>Pricing</title><style>.a{}</style></head><body><nav>Menu</nav><script>evil()</script><h1>API pricing</h1><p>Input: <b>$2.50</b> per 1M tokens.</p><p>Output: $10 per 1M.</p></body></html>';
  const ok = async () => new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  const r = await s.webFetch("https://example.com/pricing", { fetch: ok as never, lookup: async () => "93.184.216.34" });
  assert.equal(r.title, "Pricing");
  assert.match(r.text, /API pricing/);
  assert.match(r.text, /Input: \$2\.50 per 1M tokens\./);
  assert.doesNotMatch(r.text, /evil\(\)|\.a\{\}/, "no scripts or styles");

  const big = async () => new Response(`<p>${"x".repeat(100000)}</p>`, { headers: { "content-type": "text/html" } });
  assert.ok((await s.webFetch("https://example.com/big", { fetch: big as never, lookup: async () => "93.184.216.34", maxChars: 5000 })).text.length <= 5100, "cut");

  for (const u of ["http://localhost:9333/api/knowledge/export", "http://127.0.0.1/", "http://192.168.1.10/admin", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd", "ftp://example.com/x"]) {
    await assert.rejects(s.webFetch(u, { fetch: ok as never }), /not allowed|only http/i, u);
  }
  // A name that resolves to a private address, and a redirect there.
  await assert.rejects(s.webFetch("https://evil.example/", { fetch: ok as never, lookup: async () => "10.0.0.5" }), /not allowed/i);
  const redirect = async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:9333/" } });
  await assert.rejects(s.webFetch("https://example.com/r", { fetch: redirect as never, lookup: async (h) => (h === "example.com" ? "93.184.216.34" : "127.0.0.1") }), /not allowed/i, "a redirect to the local network");
  await assert.rejects(s.webFetch("https://example.com/bin", { fetch: (async () => new Response("x", { headers: { "content-type": "application/zip" } })) as never, lookup: async () => "93.184.216.34" }), /isn't text/i);
});

test("the tools: web_search and web_fetch in the MCP's and the chat's tools — only while the plugin is installed and set up", async () => {
  const { setInstalled } = await import("@/plugins/state");
  const { registerWebSearchTools } = await import("@/plugins/web-search/mcp");
  const names = () => {
    const seen: string[] = [];
    registerWebSearchTools({ registerTool: (n: string) => void seen.push(n) } as never, { run: async (f: () => unknown) => f(), ok: (t: string) => t, fail: (t: string) => t } as never);
    return seen;
  };
  assert.deepEqual(names().sort(), ["web_fetch", "web_search"]);
  setInstalled("web-search", false);
  const tools: Record<string, (a: unknown) => Promise<unknown>> = {};
  registerWebSearchTools({ registerTool: (n: string, _m: unknown, h: (a: unknown) => Promise<unknown>) => (tools[n] = h) } as never, { run: async (f: () => unknown) => f(), ok: (t: string) => t, fail: (t: string) => `FAIL ${t}` } as never);
  assert.match(String(await tools.web_search({ query: "x" })), /FAIL .*not installed/i, "plugin off: a clear message");
});
