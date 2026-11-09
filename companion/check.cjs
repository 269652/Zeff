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
  let file = path.join(APP, p === "/" ? "index.html" : p.slice(1));
  if (!file.startsWith(APP) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(APP, "index.html"); // like GitHub's 404.html
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(fs.readFileSync(file));
});

srv.listen(0, "127.0.0.1", async () => {
  const appUrl = `http://127.0.0.1:${srv.address().port}/`;
  const port = 19000 + Math.floor(Math.random() * 900);
  const make = () => new Companion({ ndc, dir: path.join(OUT, "state"), port, zeffUrl: ZEFF, appUrl, log: (l) => console.log("  [launcher]", l) });
  let comp = make();
  comp.start();
  // With Chromium's coming rule switched on (a page may not rewrite its ICE ufrag/password — the old handshake broke on it).
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--force-fieldtrials=WebRTC-NoSdpMangleUfrag/Enabled/"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "de-DE" });
  // The app's own view of the todos even while connected (else Zeff fills the screen): this checks the protocol, the queue.
  await ctx.addInitScript(() => localStorage.setItem("zeff.liteOnly", "true"));
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && console.log("  [page error]", m.text()));
  page.on("pageerror", (e) => console.log("  [page exception]", e.message));
  // The offline app's todos (companion/offline): the open ones are in the sections, the done ones folded below.
  const openTodos = () => page.locator(".zo-page > section .zo-todo");
  const item = (text) => page.locator(".zo-page > section .zo-todo", { hasText: text });
  const tick = (text) => item(text).locator("input[type=checkbox]").click();
  const barText = () => page.locator(".zo-state").innerText().catch(() => "");
  const queueEmpty = async () => !/wartend|waiting/.test(await barText());
  let ok = true;
  const check = (cond, what) => {
    console.log(`  ${cond ? "PASS" : "FAIL"} ${what}`);
    if (!cond) ok = false;
  };
  try {
    step("no PC paired yet: how to get Zeff");
    await page.goto(appUrl);
    await until("setup shown", async () => !(await page.locator("#setup").isHidden()));
    check(await page.locator("#setup").evaluate((d) => d.open), "the setup steps are open");
    check((await page.locator('#setup a[href="https://getzeff.com/#download"]').count()) === 1, "with the download link");
    check(await page.locator("#checks").isHidden(), "no connection checks (nothing paired)");
    await page.screenshot({ path: path.join(OUT, "phone-new.png") });

    step("pair: open the QR link");
    const { url } = comp.pair("Test phone");
    console.log(`  link: ${url.length} characters`);
    await page.goto(url);
    await until("live", () => page.locator(".status.live").count());
    await until("3 todos", async () => (await openTodos().count()) === 3, 60000);
    check(!(await page.evaluate(() => location.hash)), "pairing secret removed from the address bar");
    check(comp.status().devices.some((d) => d.connected), "launcher shows the phone connected");
    await page.screenshot({ path: path.join(OUT, "phone-live.png") });

    step("live tick on the phone → PC");
    let t0 = Date.now();
    await tick(T.plumber);
    await until("done on PC", async () => (await zeffTodo(T.plumber))?.status === "done");
    check(true, `ticked on the PC after ${Date.now() - t0} ms`);
    await until("queue empty", queueEmpty);
    check(true, "phone queue empty");

    step("change on the PC → phone, live");
    t0 = Date.now();
    await post([{ id: `pc-${TAG}`, at: new Date().toISOString(), kind: "flag", todoId: T.billId, flagged: true }]);
    await until("flag on phone", async () => (await item(T.bill).locator(".zo-flag").count()) === 1);
    check(true, `phone shows the flag after ${Date.now() - t0} ms`);

    step("away from home: PC unreachable, tick on the phone");
    comp.stop();
    await until("phone notices", () => page.locator(".status.away").count(), 20000);
    await tick(T.anna);
    await until("one waiting", async () => /1 (wartend|waiting)/.test(await barText()), 5000).catch(() => null);
    { const bar = await barText(); check(/1 (wartend|waiting)/.test(bar), `the bar shows one change waiting ("${bar}")`); }
    check((await zeffTodo(T.anna))?.status === "open", "the PC doesn't have it yet");
    const helpFolded = async () => !(await page.locator("#setup").isHidden()) && !(await page.locator("#setup").evaluate((d) => d.open));
    // (Between two connection attempts: while one runs, the help steps aside.)
    check(!!(await until("help folded", helpFolded, 25000).catch(() => false)), "help offered, folded (the todos are there)");
    await page.screenshot({ path: path.join(OUT, "phone-away.png") });

    step("paired with a PC it never reached: help open");
    {
      const other = await ctx.browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: "en-US" });
      const p2 = await other.newPage();
      // A pairing whose PC doesn't answer (a port nothing listens on).
      const link = comp.link({ id: "nobody", secret: Buffer.alloc(32).toString("base64") }).replace(/#p=(.+)$/, (_, b) => {
        const j = JSON.parse(Buffer.from(b, "base64url").toString());
        return `#p=${Buffer.from(JSON.stringify({ ...j, p: port + 1 })).toString("base64url")}`;
      });
      await p2.goto(link);
      await until("help open", async () => !(await p2.locator("#setup").isHidden()) && (await p2.locator("#setup").evaluate((d) => d.open)), 20000);
      check(!(await p2.locator("#checks").isHidden()), "what to check, and how to install Zeff");
      await p2.screenshot({ path: path.join(OUT, "phone-unreachable.png"), fullPage: true });
      await other.close();
    }

    step("the app opens without any network (service worker)");
    await ctx.setOffline(true);
    await page.reload();
    await until("rendered offline", async () => (await page.locator(".zo-todo").count()) >= 3);
    check(true, "app and todos from the phone's own storage");
    await ctx.setOffline(false);

    step("back home: the queue goes to the PC");
    comp = make();
    comp.start();
    await page.locator("#status").click(); // (else the next try within 20 s)
    await until("Anna done on PC", async () => (await zeffTodo(T.anna))?.status === "done", 20000);
    check(true, "the tick made away is done on the PC");
    await until("queue empty", queueEmpty, 20000);
    check(true, "phone queue empty again");

    step("the same change sent twice is applied once");
    const op = { id: `dup-${TAG}`, at: new Date().toISOString(), kind: "note", todoId: T.billId, text: "from the phone" };
    const first = (await post([op])).results[0];
    const second = (await post([op])).results[0];
    check(first.ok && !first.skipped && second.skipped === "already applied", `applied once (${JSON.stringify(second)})`);

    step("accounts: three on the PC (Work, Privat, and Club behind Zeff's lock)");
    fs.writeFileSync(path.join(DATA, "accounts.json"), JSON.stringify({ installed: true, active: "default", accounts: [
      { id: "default", name: "Work", color: "indigo", createdAt: new Date().toISOString() },
      { id: "privat", name: "Privat", color: "emerald", createdAt: new Date().toISOString() },
      { id: "club", name: "Club", color: "rose", createdAt: new Date().toISOString() },
    ] }));
    fs.writeFileSync(path.join(DATA, "lock.json"), JSON.stringify({ enabled: true, secret: "x".repeat(43), openAccounts: ["default", "privat"] }));
    const zeffIn = async (prefix, text) => (await (await fetch(`${ZEFF}${prefix}/api/companion`)).json()).todos?.find((t) => t.text === text);
    // Privat's database is made on its first request; then a todo of its own.
    await until("privat answers", async () => (await fetch(`${ZEFF}/privat/api/companion`)).ok, 60000);
    const P = { home: `Water the plants ${TAG}`, gift: `Buy a gift for Mia ${TAG}` };
    {
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(path.join(DATA, "accounts", "privat", "zeff.db"));
      const now = new Date().toISOString();
      const add = db.prepare("insert into todos (ticket, text, kind, owner, status, source, refs, run_id, created_at, updated_at) values ('', ?, 'other', 'me', 'open', 'From you', '[]', null, ?, ?)");
      for (const text of [P.home, P.gift]) add.run(text, now, now);
      db.close();
    }
    await page.locator("#status").click(); // a sync: the answer brings the accounts
    await until("switcher", async () => (await page.locator("#account option").count()) === 3);
    check(true, "the phone offers the three accounts");
    check((await page.locator("#account option").allTextContents()).some((t) => t.includes("🔒") && t.includes("Club")), "Club is marked locked");

    step("switch to Privat: its todos; a tick lands in Privat");
    await page.selectOption("#account", "privat");
    await until("privat todos", async () => (await item(P.home).count()) === 1 && (await item(T.bill).count()) === 0);
    check(true, "Privat's todos, none of Work's");
    await page.screenshot({ path: path.join(OUT, "phone-privat.png") });
    await tick(P.home);
    await until("done in privat", async () => (await zeffIn("/privat", P.home))?.status === "done");
    check((await zeffIn("", P.home)) === undefined, "ticked in Privat's database, Work doesn't have it");

    step("away: ticks in two accounts, each goes to its own");
    comp.stop();
    await until("phone notices", () => page.locator(".status.away").count(), 20000);
    await tick(P.gift);
    await page.selectOption("#account", "default");
    await until("work list from the phone", async () => (await item(T.bill).count()) === 1);
    check(true, "switching works offline (each account's todos kept on the phone)");
    await tick(T.bill);
    comp = make();
    comp.start();
    await page.locator("#status").click();
    await until("both applied", async () => (await zeffIn("/privat", P.gift))?.status === "done" && (await zeffTodo(T.bill))?.status === "done", 20000);
    check(true, "Privat's tick in Privat, Work's in Work");

    step("the locked account shows nothing");
    await page.selectOption("#account", "club");
    await until("locked note", () => page.locator(".zo-locked").count());
    check((await page.locator(".zo-todo").count()) === 0, "no todos of a locked account");
    await page.screenshot({ path: path.join(OUT, "phone-locked.png") });
    await page.selectOption("#account", "default");

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
