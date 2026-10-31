import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/* eslint-disable @typescript-eslint/no-explicit-any */

const info = (id: string) => ({ targetId: id, type: "page", url: `https://x/${id}` });

test("filter: the hung tab is never announced to Playwright — nor its session's messages", async () => {
  const { fromChrome } = await import("../scripts/cdp-filter.mjs");
  const hidden = new Set(["HUNG"]);
  const state: any = {};
  assert.equal(fromChrome({ method: "Target.attachedToTarget", params: { sessionId: "s1", targetInfo: info("HUNG"), waitingForDebugger: false } }, hidden, state), null);
  assert.equal(fromChrome({ sessionId: "s1", method: "Page.frameNavigated", params: {} }, hidden, state), null, "its session stays silent");
  assert.equal(fromChrome({ method: "Target.targetCreated", params: { targetInfo: info("HUNG") } }, hidden, state), null);
  assert.equal(fromChrome({ method: "Target.targetInfoChanged", params: { targetInfo: info("HUNG") } }, hidden, state), null);
  assert.equal(fromChrome({ method: "Target.targetCrashed", params: { targetId: "HUNG" } }, hidden, state), null);
  assert.equal(fromChrome({ method: "Target.detachedFromTarget", params: { sessionId: "s1" } }, hidden, state), null);

  // A good tab goes through, session and all.
  const good = { method: "Target.attachedToTarget", params: { sessionId: "s2", targetInfo: info("GOOD") } };
  assert.equal(fromChrome(good, hidden, state), good);
  const msg = { sessionId: "s2", method: "Page.frameNavigated", params: {} };
  assert.equal(fromChrome(msg, hidden, state), msg);
});

test("filter: Target.getTargets answers are cut — only the client's own requests", async () => {
  const { fromChrome, fromClient } = await import("../scripts/cdp-filter.mjs");
  const hidden = new Set(["HUNG"]);
  const state: any = {};
  fromClient({ id: 7, method: "Target.getTargets" }, state);
  fromClient({ id: 8, method: "Browser.getVersion" }, state);
  const answer = fromChrome({ id: 7, result: { targetInfos: [info("HUNG"), info("GOOD")] } }, hidden, state) as any;
  assert.deepEqual(answer.result.targetInfos.map((t: any) => t.targetId), ["GOOD"]);
  const other = { id: 8, result: { product: "Chrome" } };
  assert.equal(fromChrome(other, hidden, state), other);
  // Answered once: a later message with that id is not touched.
  const again = { id: 7, result: { targetInfos: [info("HUNG")] } };
  assert.equal(fromChrome(again, hidden, state), again);
});

/** A free local port. */
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

test("connectToChrome attaches to a Chrome with a hung tab — closing that tab (not a web page: not reopened) — instead of failing", { timeout: 120000 }, async (t) => {
  const { findBrowser } = await import("../scripts/browser-find.mjs");
  const browser = findBrowser();
  if (!browser) return t.skip("no Chrome/Edge here");
  const { connectToChrome } = await import("../scripts/chrome-cdp.mjs");
  const port = await freePort();
  const cdp = `http://127.0.0.1:${port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-hung-"));
  const chrome = spawn(browser.path, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    let up = false;
    for (let i = 0; i < 60 && !(up = await fetch(`${cdp}/json/version`).then((r) => r.ok).catch(() => false)); i++) await sleep(500);
    if (!up) return t.skip("the headless browser did not come up in 30 s (a busy machine)");
    // A good tab, and one whose renderer never comes back.
    await fetch(`${cdp}/json/new?${encodeURIComponent("data:text/html,<title>good</title>ok")}`, { method: "PUT" });
    await fetch(`${cdp}/json/new?${encodeURIComponent("data:text/html,<title>hung</title><script>setTimeout(()=>{while(true){}},300)</script>")}`, { method: "PUT" });
    // Not a fixed wait (a busy machine loads slower): both tabs titled, then the hung one past its 300 ms and stuck.
    const titled = async () => {
      const list = (await fetch(`${cdp}/json/list`).then((r) => r.json()).catch(() => [])) as { type: string; title: string }[];
      return ["good", "hung"].every((x) => list.some((p) => p.type === "page" && p.title === x));
    };
    for (let i = 0; i < 40 && !(await titled()); i++) await sleep(500);
    await sleep(2000);

    const pw = await connectToChrome(cdp, { timeout: 20000 });
    try {
      const titles = await Promise.all(pw.contexts()[0].pages().map((p: any) => p.title().catch(() => "?")));
      assert.ok(titles.includes("good"), `the good tab is there (${titles.join(", ")})`);
      assert.ok(!titles.includes("hung"), "the hung tab is gone");
      assert.equal((pw as any).hungTabs, undefined, "closed, not hidden");
      const left = (await (await fetch(`${cdp}/json/list`)).json()) as { type: string; title: string }[];
      assert.ok(!left.some((x) => x.type === "page" && x.title === "hung"), "closed in Chrome itself");
    } finally {
      await pw.close();
    }
  } finally {
    chrome.kill();
    await sleep(800);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      // still in use: left for the temp folder's cleaning
    }
  }
});
