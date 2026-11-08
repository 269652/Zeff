// The phone companion end to end: the launcher's Companion (launcher/lib/companion) against a disposable Zeff test
// server, the phone app (companion/app) in headless Chrome as a phone — pairing by the QR link, a live tick, a change
// on the PC reaching the phone, a tick while away queued and sent on return, the app opening offline, unpairing.
//
//   npm run test:server                      → note its url and dataDir
//   node companion/check.cjs <url> <dataDir>
//   npm run test:server -- --stop <port>
//
// Never against the live Zeff (it adds todos and closes the others). Screenshots go to a temp folder.
const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const REPO = path.resolve(__dirname, "..");
const ndc = require(path.join(REPO, "launcher/node_modules/node-datachannel"));
const { Companion } = require(path.join(REPO, "launcher/lib/companion"));
const { chromium } = require(path.join(REPO, "node_modules/playwright-core"));

const ZEFF = process.argv[2]?.replace(/\/+$/, "");
const DATA = process.argv[3];
if (!ZEFF || !DATA) throw new Error("usage: node companion/check.cjs <test server url> <its dataDir>");
if (/:9333\b/.test(ZEFF)) throw new Error("not the live Zeff");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-companion-check-"));
const CHROME = process.env.CHROME_PATH ?? (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined);
const APP = path.join(__dirname, "app");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

// Three todos of this run (their texts carry a tag); the test server's other open todos are closed, so the list is just these.
const TAG = Date.now().toString(36);
const T = { plumber: `Call the plumber ${TAG}`, bill: `Pay the electricity bill ${TAG}`, anna: `Reply to Anna about Sunday ${TAG}` };
{
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.join(DATA, "zeff.db"));
  const now = new Date().toISOString();
  db.prepare("update todos set status = 'done', done_at = ? where status = 'open'").run(now);
  const add = db.prepare("insert into todos (ticket, text, kind, owner, status, source, refs, run_id, created_at, updated_at) values ('', ?, 'other', 'me', 'open', 'From you', '[]', null, ?, ?)");
  for (const text of [T.plumber, T.bill, T.anna]) add.run(text, now, now);
  T.billId = db.prepare("select id from todos where text = ?").get(T.bill).id;
  db.close();
}

const step = (s) => console.log(`\n== ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const zeffTodo = async (text) => (await (await fetch(`${ZEFF}/api/companion`)).json()).todos.find((t) => t.text === text);
const post = (ops) => fetch(`${ZEFF}/api/companion`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops }) }).then((r) => r.json());
async function until(what, fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(250);
  }
}

const srv = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const file = path.join(APP, p === "/" ? "index.html" : p.slice(1));
  if (!file.startsWith(APP) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(fs.readFileSync(file));
});

srv.listen(0, "127.0.0.1", async () => {
  const appUrl = `http://127.0.0.1:${srv.address().port}/`;
  const port = 19000 + Math.floor(Math.random() * 900);
  const make = () => new Companion({ ndc, dir: path.join(OUT, "state"), port, zeffUrl: ZEFF, appUrl, log: (l) => console.log("  [launcher]", l) });
  let comp = make();
  comp.start();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "de-DE" });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && console.log("  [page error]", m.text()));
  page.on("pageerror", (e) => console.log("  [page exception]", e.message));
  const item = (text) => page.locator("#open .todo", { hasText: text });
  const outbox = () => page.evaluate(() => JSON.parse(localStorage.getItem("zeff.outbox") ?? "[]"));
  let ok = true;
  const check = (cond, what) => {
    console.log(`  ${cond ? "PASS" : "FAIL"} ${what}`);
    if (!cond) ok = false;
  };
  try {
    step("pair: open the QR link");
    const { url } = comp.pair("Test phone");
    console.log(`  link: ${url.length} characters`);
    await page.goto(url);
    await until("live", () => page.locator(".status.live").count());
    await until("3 todos", async () => (await page.locator("#open .todo").count()) === 3);
    check(!(await page.evaluate(() => location.hash)), "pairing secret removed from the address bar");
    check(comp.status().devices.some((d) => d.connected), "launcher shows the phone connected");
    await page.screenshot({ path: path.join(OUT, "phone-live.png") });

    step("live tick on the phone → PC");
    let t0 = Date.now();
    await item(T.plumber).locator("input").click();
    await until("done on PC", async () => (await zeffTodo(T.plumber))?.status === "done");
    check(true, `ticked on the PC after ${Date.now() - t0} ms`);
    await until("queue empty", async () => (await outbox()).length === 0);
    check(true, "phone queue empty");

    step("change on the PC → phone, live");
    t0 = Date.now();
    await post([{ id: `pc-${TAG}`, at: new Date().toISOString(), kind: "flag", todoId: T.billId, flagged: true }]);
    await until("star on phone", async () => (await item(T.bill).locator("button[aria-pressed=true]").count()) === 1);
    check(true, `phone shows the flag after ${Date.now() - t0} ms`);

    step("away from home: PC unreachable, tick on the phone");
    comp.stop();
    await until("phone notices", () => page.locator(".status.away").count(), 20000);
    await item(T.anna).locator("input").click();
    check(/1/.test(await page.locator("#statusText").textContent()), "status shows one change waiting");
    check((await zeffTodo(T.anna))?.status === "open", "the PC doesn't have it yet");
    await page.screenshot({ path: path.join(OUT, "phone-away.png") });

    step("the app opens without any network (service worker)");
    await ctx.setOffline(true);
    await page.reload();
    await until("rendered offline", async () => (await page.locator(".todo").count()) >= 3);
    check(true, "app and todos from the phone's own storage");
    await ctx.setOffline(false);

    step("back home: the queue goes to the PC");
    comp = make();
    comp.start();
    await page.locator("#status").click(); // (else the next try within 20 s)
    await until("Anna done on PC", async () => (await zeffTodo(T.anna))?.status === "done", 20000);
    check(true, "the tick made away is done on the PC");
    await until("queue empty", async () => (await outbox()).length === 0);
    check(true, "phone queue empty again");

    step("the same change sent twice is applied once");
    const op = { id: `dup-${TAG}`, at: new Date().toISOString(), kind: "note", todoId: T.billId, text: "from the phone" };
    const first = (await post([op])).results[0];
    const second = (await post([op])).results[0];
    check(first.ok && !first.skipped && second.skipped === "already applied", `applied once (${JSON.stringify(second)})`);

    step("an unpaired phone is turned away");
    comp.unpair(comp.status().devices[0].id);
    await until("phone sees unpaired", async () => {
      await page.locator("#status").click().catch(() => {});
      return page.locator(".status.denied").count();
    }, 20000);
    check(true, "phone says unpaired; its pairing is gone");
  } catch (e) {
    ok = false;
    console.log("  ERROR", e.message);
    await page.screenshot({ path: path.join(OUT, "phone-error.png") }).catch(() => {});
  }
  await browser.close();
  comp.stop();
  srv.close();
  console.log(ok ? "\nALL PASSED" : "\nFAILURES", `(screenshots: ${OUT})`);
  process.exit(ok ? 0 : 1);
});
