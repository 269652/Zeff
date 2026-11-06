import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

let site: http.Server;
let base = "";
const hits: string[] = [];
const agents: string[] = [];
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

before(async () => {
  site = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    agents.push(req.headers["user-agent"] ?? "");
    if (req.url?.startsWith("/poster")) return void res.writeHead(200, { "content-type": "image/png" }).end(PIXEL);
    if (req.url === "/two-hosts") return void res.writeHead(200, { "content-type": "text/html" }).end(`<img src="/poster-here.png"><img src="${base.replace("127.0.0.1", "localhost")}/poster-there.png">`);
    if (req.url === "/refused") return void res.writeHead(403).end("no");
    if (req.url === "/next") return void res.writeHead(200, { "content-type": "text/html" }).end("<title>Second</title><p>The second page</p>");
    res.writeHead(200, { "content-type": "text/html" }).end(`<title>Film</title><meta property="og:image" content="${base}/poster.png">
      <h1>Static</h1><a href="/next">Weiter</a>
      <div id=out></div><script>document.getElementById("out").textContent = "Written by JavaScript";</script>`);
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});
after(() => site.close());

/** The test's site counts as public. */
const check = async (url: string) => new URL(url);

test("the machine's own and private addresses are refused before a browser starts", async () => {
  const { browserOpen } = await import("@/plugins/browser/browse");
  for (const url of ["http://127.0.0.1:9333/", "http://localhost:9333/", "http://192.168.1.1/", "file:///C:/Windows/win.ini"]) {
    await assert.rejects(browserOpen(url, {}, { launch: async () => assert.fail("no browser for this") }));
  }
});

test("a page in a real browser: what JavaScript wrote, its main picture, its links; a step goes on from there", async (t) => {
  const { browserOpen } = await import("@/plugins/browser/browse");
  let page;
  try {
    page = await browserOpen(`${base}/`, {}, { check });
  } catch (e) {
    if (/No browser to start/.test(String(e))) return t.skip("no Chrome here");
    throw e;
  }
  assert.match(agents.at(-1) ?? "", / Chrome\/\d+/, "it comes as the Chrome it is");
  assert.doesNotMatch(agents.join(), /Headless/);
  assert.equal(page.title, "Film");
  assert.equal(page.status, 200);
  assert.match(page.text, /Written by JavaScript/);
  assert.equal(page.mainImage, `${base}/poster.png`);
  assert.deepEqual(page.links, [{ href: `${base}/next`, text: "Weiter" }]);

  const second = await browserOpen(`${base}/`, { steps: [{ action: "click", target: "Weiter" }] }, { check });
  assert.equal(second.title, "Second");
  assert.equal(second.url, `${base}/next`);

  assert.equal((await browserOpen(`${base}/refused`, {}, { check })).status, 403);
});

test("what a page loads goes through the same check: a picture on a private host isn't fetched", async (t) => {
  const { browserOpen } = await import("@/plugins/browser/browse");
  hits.length = 0;
  // The page is on 127.0.0.1 (allowed here); its picture on localhost, the same server under a name the check refuses.
  const onlyThisHost = async (url: string) => {
    if (new URL(url).hostname !== "127.0.0.1") throw new Error("not allowed");
  };
  try {
    await browserOpen(`${base}/two-hosts`, {}, { check: onlyThisHost });
  } catch (e) {
    if (/No browser to start/.test(String(e))) return t.skip("no Chrome here");
    throw e;
  }
  assert.ok(hits.includes("/two-hosts"));
  assert.ok(hits.includes("/poster-here.png"), "the same host's picture loads");
  assert.ok(!hits.includes("/poster-there.png"), hits.join());
});
