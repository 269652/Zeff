import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The in-page probe, installed on a fake global (what WhatsApp Web / Signal Desktop would be). */
async function probeOn(g: any): Promise<any> {
  const { installProbe } = await import("../scripts/automation/probe.mjs");
  g.window = g;
  (globalThis as any).window = g;
  (globalThis as any).document = g.document;
  return installProbe(g, "test");
}

/** A page of CSS: `selectors` maps a selector to how many elements it has. */
const dom = (selectors: Record<string, number>) => ({
  querySelector: (q: string) => (q.split(",").some((s) => (selectors[s.trim()] ?? 0) > 0) ? { tag: q } : null),
  querySelectorAll: (q: string) => Array.from({ length: selectors[q.trim()] ?? 0 }, () => ({ tag: q })),
  body: { innerText: "" },
  documentElement: { lang: "de" },
});

/** A module registry like WhatsApp Web's `require`: modules by name, + require("__debug").modulesMap for the scan. */
function registry(modules: Record<string, any>) {
  const modulesMap = Object.fromEntries(Object.entries(modules).map(([n, m]) => [n, { exports: { default: m }, defaultExport: m }]));
  return (name: string) => {
    if (name === "__debug") return { modulesMap };
    if (!(name in modules)) throw new Error(`Requiring unknown module "${name}"`);
    return modules[name];
  };
}

const LOADER = { names: ["WAWebChatLoadMessages"], has: ["loadEarlierMsgs:function"] };

test("probe: a module is found by its name — or, renamed, by what it can do", async () => {
  const loader = { loadEarlierMsgs: async () => {}, loadRecentMsgs: async () => {} };
  const byName = await probeOn({ require: registry({ WAWebChatLoadMessages: loader }) });
  assert.deepEqual({ via: byName.module(LOADER).via, same: byName.module(LOADER).mod === loader }, { via: "name", same: true });

  // The app renamed it: not under the known name any more.
  const renamed = await probeOn({ require: registry({ WAWebChatLoadMessagesV2: loader, WAWebSomethingElse: { other: () => 1 } }) });
  const r = renamed.module(LOADER);
  assert.equal(r.via, "scan");
  assert.equal(r.name, "WAWebChatLoadMessagesV2");
  assert.equal(r.mod, loader);

  // Gone: nothing has the member.
  const gone = await probeOn({ require: registry({ WAWebSomethingElse: { other: () => 1 } }) });
  assert.equal(gone.module(LOADER), null);
  // No module system at all (not WhatsApp Web): null, not a throw.
  assert.equal((await probeOn({})).module(LOADER), null);
});

test("probe: several modules with the member — the one closest to the known name wins", async () => {
  const a = { loadEarlierMsgs: () => 1, tag: "a" };
  const b = { loadEarlierMsgs: () => 1, tag: "b" };
  const p = await probeOn({ require: registry({ WAWebZzz: a, WAWebChatLoadMessagesLegacy: b }) });
  const r = p.module(LOADER);
  assert.equal(r.via, "scan");
  assert.equal(r.candidates, 2);
  assert.equal(r.mod.tag, "b");
});

test("probe: a module that lacks a wanted member is not taken for the module (shape, not just the name)", async () => {
  const p = await probeOn({ require: registry({ WAWebChatLoadMessages: { somethingNew: () => 1 } }) });
  assert.equal(p.module(LOADER), null);
});

test("probe: globals by path with alternatives and members", async () => {
  const CC = { getAll: () => [], get: () => null, getOurConversationId: () => "x" };
  const spec = { paths: ["ConversationController"], type: "object", has: ["getAll:function", "get:function", "getOurConversationId:function"] };
  assert.equal((await probeOn({ ConversationController: CC })).global(spec).via, "name");
  const moved = await probeOn({ Whisper: { ConversationController: CC } });
  assert.equal(moved.global({ ...spec, paths: ["ConversationController", "Whisper.ConversationController"] }).via, "alt");
  assert.equal((await probeOn({ ConversationController: { getAll: () => [] } })).global(spec), null);
  assert.equal((await probeOn({})).global(spec), null);
});

test("probe: pick takes the first path that has a value", async () => {
  const p = await probeOn({});
  const paths = ["nav.selectedLocation.details.conversationId", "conversations.selectedConversationId"];
  assert.equal(p.pick({ nav: { selectedLocation: { details: { conversationId: "a" } } }, conversations: { selectedConversationId: "b" } }, paths), "a");
  assert.equal(p.pick({ conversations: { selectedConversationId: "b" } }, paths), "b");
  assert.equal(p.pick({}, paths), undefined);
});

test("probe: check reports ok / drift / warn / fail / skip", async () => {
  const contract = {
    modules: { loader: LOADER, me: { names: ["WAWebUserPrefsMeUser"], has: ["isMeAccount:function"], optional: true }, gone: { names: ["Nope"], has: ["nope:function"] } },
    selectors: {
      list: { any: ["#pane-side"] },
      rows: { any: ['[role="listitem"]', '[role="row"]'] },
      qr: { any: ["canvas.qr"], transient: true },
      opt: { any: [".opt"], optional: true },
      main: { any: ["#main"], optional: true },
      header: { any: ["#main header"], when: "main" },
      lost: { any: [".lost"] },
    },
  };
  const g: any = { require: registry({ WAWebChatLoadMessagesV2: { loadEarlierMsgs: () => 1 } }), document: dom({ "#pane-side": 1, '[role="row"]': 26 }) };
  const checks = (await probeOn(g)).check(contract);
  const level = (kind: string, id: string) => checks.find((c: any) => c.kind === kind && c.id === id)?.level;
  assert.equal(level("module", "loader"), "drift"); // found by scan
  assert.equal(level("module", "me"), "warn"); // optional, missing
  assert.equal(level("module", "gone"), "fail");
  assert.equal(level("selector", "list"), "ok");
  assert.equal(level("selector", "rows"), "drift"); // the second alternative matched
  assert.equal(level("selector", "qr"), "skip"); // transient
  assert.equal(level("selector", "opt"), "warn");
  assert.equal(level("selector", "header"), "skip"); // needs #main, which isn't open
  assert.equal(level("selector", "lost"), "fail");
});

test("probe: a probe of another source replaces the installed one", async () => {
  const { installProbe } = await import("../scripts/automation/probe.mjs");
  const g: any = {};
  const a = installProbe(g, "v1");
  assert.equal(installProbe(g, "v1"), a);
  assert.notEqual(installProbe(g, "v2"), a);
});

test("contract: an override file is merged over the defaults, id by id; null removes; a broken one is ignored", async () => {
  const { loadContract, mergeContract, report } = await import("../scripts/automation/contract.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-contract-"));
  try {
    const defaults = path.join(dir, "defaults.json");
    fs.writeFileSync(defaults, JSON.stringify({ app: "x", version: 1, modules: { a: { names: ["A"] }, b: { names: ["B"] } }, selectors: { s: { any: ["#s"] } }, texts: { t: ["one"] } }));
    const env = { ZEFF_AUTOMATION_DIR: path.join(dir, "automation") } as unknown as NodeJS.ProcessEnv;
    fs.mkdirSync(env.ZEFF_AUTOMATION_DIR!);

    // No override file: the defaults.
    assert.equal(loadContract("x", defaults, { env }).overridden, false);

    fs.writeFileSync(path.join(env.ZEFF_AUTOMATION_DIR!, "x.json"), JSON.stringify({ modules: { a: { names: ["A2", "A"] }, b: null }, texts: { t: ["two"] } }));
    const c = loadContract("x", defaults, { env });
    assert.equal(c.overridden, true);
    assert.deepEqual(c.modules, { a: { names: ["A2", "A"] } });
    assert.deepEqual(c.selectors, { s: { any: ["#s"] } });
    assert.deepEqual(c.texts, { t: ["two"] });
    // The properties about the override don't travel into the page with the contract.
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(c))).sort(), ["app", "modules", "selectors", "texts", "version"]);

    fs.writeFileSync(path.join(env.ZEFF_AUTOMATION_DIR!, "x.json"), "{ not json");
    const broken = loadContract("x", defaults, { env });
    assert.equal(broken.overridden, false);
    assert.match(String(broken.overrideError), /x\.json/);
    assert.equal(report("x", [], broken).overrideError, broken.overrideError);

    assert.deepEqual(mergeContract({ modules: { a: 1 } }, undefined).modules, { a: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("contract: the report says what is missing and what drifted", async () => {
  const { report } = await import("../scripts/automation/contract.mjs");
  const ok = report("x", [{ kind: "module", id: "a", level: "ok" }], { version: 1 });
  assert.deepEqual({ ok: ok.ok, drifted: ok.drifted, summary: ok.summary }, { ok: true, drifted: false, summary: "all as expected" });
  const bad = report("x", [{ kind: "module", id: "a", level: "fail", detail: "no module" }, { kind: "selector", id: "r", level: "drift", detail: "[role=row] ×3" }, { kind: "selector", id: "o", level: "warn" }], { version: 1 });
  assert.equal(bad.ok, false);
  assert.equal(bad.drifted, true);
  assert.deepEqual(bad.failed, ["module:a"]);
  assert.match(bad.summary, /^The app changed, a sync may fail — missing: module a/);
  assert.match(bad.summary, /selector r/);
});

test("both plugins' contracts are well-formed", () => {
  for (const app of ["whatsapp", "signal"]) {
    const c = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src", "plugins", app, "contract.json"), "utf8"));
    assert.equal(c.app, app);
    for (const [id, m] of Object.entries<any>(c.modules ?? {})) {
      assert.ok(m.names?.length && m.has?.length, `${app} module ${id}: names and has`);
    }
    for (const [id, g] of Object.entries<any>(c.globals ?? {})) assert.ok(g.paths?.length, `${app} global ${id}: paths`);
    for (const [id, s] of Object.entries<any>(c.selectors ?? {})) {
      assert.ok(s.any?.length, `${app} selector ${id}: any`);
      if (s.when) assert.ok(c.selectors[s.when], `${app} selector ${id}: when → ${s.when} exists`);
    }
    for (const [id, list] of Object.entries<any>(c.texts ?? {})) for (const p of list) assert.doesNotThrow(() => new RegExp(p, "i"), `${app} text ${id}: ${p}`);
  }
});

test("mcp-stdio: initialize, tools/list, tools/call, unknown tool, a throwing tool", async () => {
  const { createMcp } = await import("../scripts/automation/mcp-stdio.mjs");
  const mcp = createMcp({
    name: "t",
    tools: [{ name: "ok" }, { name: "boom" }],
    handlers: { ok: async (a: any) => `hi ${a.who}`, boom: async () => { throw new Error("it broke"); } },
  });
  assert.equal((await mcp.handle({ id: 1, method: "initialize" })).result.serverInfo.name, "t");
  assert.equal(await mcp.handle({ method: "notifications/initialized" }), undefined);
  assert.equal((await mcp.handle({ id: 2, method: "tools/list" })).result.tools.length, 2);
  assert.equal((await mcp.handle({ id: 3, method: "tools/call", params: { name: "ok", arguments: { who: "you" } } })).result.content[0].text, "hi you");
  const unknown = (await mcp.handle({ id: 4, method: "tools/call", params: { name: "nope" } })).result;
  assert.equal(unknown.isError, true);
  const boom = (await mcp.handle({ id: 5, method: "tools/call", params: { name: "boom" } })).result;
  assert.deepEqual({ err: boom.isError, text: boom.content[0].text }, { err: true, text: "Error: it broke" });
  assert.deepEqual((await mcp.handle({ id: 6, method: "ping" })).result, {});
});
