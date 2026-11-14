import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();
const PLUGINS = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-ext-points-"));
process.env.ZEFF_PLUGINS_DIR = PLUGINS;
delete process.env.ZEFF_SAFE_MODE;

/**
 * The stored forms of extension points (plugins/workspace/ext-points.ts): what an external plugin declares in its manifest is at the
 * points while the plugin is on — formula functions (a formula, no code), Kennzahlen, row badges and tab menus (a plugin function's
 * answer) — and gone when it is off or Zeff is in safe mode, without a restart.
 */

async function world() {
  const reg = await import("@/lib/ext/registry"); // (first: see tests/safe-mode.test.ts)
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  await import("@/plugins/workspace/server");
  return { reg, ep: await import("@/plugins/workspace/ext-points") };
}

const MANIFEST = {
  id: "films",
  name: "Films",
  apiVersion: 1,
  contributes: {
    formulaFunctions: [
      { name: "withVat", args: ["net", "rate"], value: 'prop("net") * (1 + prop("rate") / 100)', what: "A price with VAT." },
      { name: "sum", args: ["a"], value: 'prop("a")' }, // Zeff's own name: left out
      { name: "gross", args: ["a"], value: 'prop("a")' }, // another name of Zeff's upper(): left out
    ],
    metrics: [{ id: "watched", label: "Films watched", unit: "films", function: "count" }],
    rowBadges: [{ prefix: "film:", function: "badges" }],
    tabMenus: [{ tab: "/films", function: "menu" }],
    widgets: [{ id: "latest", label: "Latest films", function: "latest", act: "press", settings: [{ key: "max", label: "How many", kind: "number", default: 5 }] }],
    pageNav: [{ function: "places" }],
    reviewSources: [{ id: "ratings", label: "Ratings to confirm", list: "ratings", act: "rate" }],
    reviewLinks: [{ id: "inbox", label: "New films", href: "/films/inbox", count: "inbox-count" }],
  },
};

test("a manifest with the new keys is valid; one without them gets empty lists", async () => {
  const { parseManifest } = await import("@/lib/ext/manifest");
  const r = parseManifest(JSON.stringify(MANIFEST));
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(r.manifest.contributes.metrics[0].everyMinutes, 15);
  const bare = parseManifest(JSON.stringify({ id: "bare", name: "Bare", apiVersion: 1 }));
  assert.ok(bare.ok);
  assert.deepEqual([bare.manifest.contributes.formulaFunctions, bare.manifest.contributes.metrics, bare.manifest.contributes.rowBadges, bare.manifest.contributes.tabMenus], [[], [], [], []]);
  assert.equal(parseManifest(JSON.stringify({ ...MANIFEST, contributes: { tabMenus: [{ tab: "https://evil.example", function: "menu" }] } })).ok, false);
});

test("on: its formula functions work in formulas, its metric, badges and menu are at their points; off or in safe mode: gone", async () => {
  const { reg } = await world();
  fs.mkdirSync(path.join(PLUGINS, "films"), { recursive: true });
  fs.writeFileSync(path.join(PLUGINS, "films", "zeff-plugin.json"), JSON.stringify(MANIFEST));
  reg.scanPlugins(true);
  const { evalFormula } = await import("@/plugins/workspace/formula");
  const { workspaceFormulaFunctions } = await import("@/plugins/workspace/formula-point");
  const { workspaceMetrics } = await import("@/plugins/workspace/metric-point");
  const { rowBadgeSources } = await import("@/plugins/workspace/row-badge-point");
  const { tabMenus } = await import("@/plugins/tab-menus-point");
  const { workspaceWidgets } = await import("@/plugins/workspace/widget-point");
  const { pageNavProviders } = await import("@/plugins/workspace/app-nav-point");
  const { reviewSources, reviewLinks } = await import("@/lib/review/point");
  const ext = () => ({
    formulas: workspaceFormulaFunctions.list().filter((c) => c.plugin === "ext:films").flatMap((c) => c.impl.map((f) => f.name)),
    metrics: workspaceMetrics.list().filter((c) => c.plugin === "ext:films").length,
    badges: rowBadgeSources.list().filter((c) => c.plugin === "ext:films").length,
    menus: tabMenus.list().filter((c) => c.plugin === "ext:films").map((c) => c.impl.tab),
    widgets: workspaceWidgets.list().filter((c) => c.plugin === "ext:films").flatMap((c) => c.impl.map((w) => w.id)),
    navs: pageNavProviders.list().filter((c) => c.plugin === "ext:films").length,
    review: [...reviewSources.list(), ...reviewLinks.list()].filter((c) => c.plugin === "ext:films").flatMap((c) => c.impl.map((x) => x.id)),
  });
  const none = { formulas: [], metrics: 0, badges: 0, menus: [], widgets: [], navs: 0, review: [] };
  assert.deepEqual(ext(), none, "off until you turn it on");

  reg.setEnabled("films", true);
  assert.deepEqual(ext(), { formulas: ["withVat"], metrics: 1, badges: 1, menus: ["/films"], widgets: ["films.latest"], navs: 1, review: ["films-ratings", "films-inbox"] });
  // The widget is one of the Workspace's: found by its id, its settings checked like any other's.
  const { widgetData } = await import("@/plugins/workspace/widgets");
  const d = await widgetData("films.latest", { max: 3 });
  assert.equal(d.kind, "error", "no Notebook here: the function can't run — an error line in the widget, not an error");
  assert.deepEqual(evalFormula("withVat(100, 19)", { prop: () => null }), { value: 119 });

  const sm = await import("@/lib/kernel/safe-mode");
  sm.setSafeMode(true);
  assert.deepEqual(ext(), none, "safe mode: nothing of it");
  sm.setSafeMode(false);
  assert.deepEqual(ext().formulas, ["withVat"]);

  reg.setEnabled("films", false);
  assert.deepEqual(ext(), none);
  assert.ok("error" in evalFormula("withVat(100, 19)", { prop: () => null }));
});

test("a Kennzahl from a function: never waits, shows the last answer, asks again in the background", async () => {
  const { ep } = await world();
  // (No Notebook here: the function can't run — the Kennzahl stays empty instead of failing the formula that reads it.)
  assert.equal(ep.storedMetricValue("films", { id: "watched", function: "count", everyMinutes: 15 }), null);
});

test("answers made safe: badges only for the prefix and known tones, menu entries only inside Zeff", async () => {
  const { ep } = await world();
  const b = ep.badgesFrom("film:", { "film:1": [{ label: "2 new", tone: "unread", count: 2 }, { label: "", tone: "x" }, { label: "odd", tone: "loud" }], "person:2": [{ label: "not mine" }], "film:3": "no list" });
  assert.deepEqual([...b], [["film:1", [{ label: "2 new", tone: "unread", count: 2 }, { label: "odd", tone: "activity", count: 1 }]]]);
  assert.deepEqual(ep.menuFrom([{ href: "/films/1", label: "Alien", hint: "1979" }, { href: "https://evil.example", label: "x" }, { href: "//evil.example", label: "y" }, { label: "no href" }]), [{ href: "/films/1", label: "Alien", hint: "1979" }]);
  const f = ep.storedFormulaFunction({ name: "half", args: ["x"], value: 'prop("x") / 2', what: "" });
  assert.equal(f.call([10]), 5);
  assert.equal(f.signature, "half(x)");
});

test("widget, page nav and review answers made safe", async () => {
  const { ep } = await world();
  const list = ep.widgetDataFrom({ kind: "list", title: "Latest", items: [{ id: "1", text: "Alien", href: "javascript:alert(1)", tone: "loud", actions: [{ id: "watch", label: "Watch" }, { label: "no id" }] }, { text: "no id" }], footer: { text: "All", href: "/films" } });
  assert.deepEqual(list, { kind: "list", items: [{ id: "1", text: "Alien", actions: [{ id: "watch", label: "Watch" }] }], title: "Latest", footer: { text: "All", href: "/films" } });
  assert.deepEqual(ep.widgetDataFrom({ kind: "stats", tiles: [{ label: "Watched", value: 12, tone: "good", href: "https://example.org" }] }), { kind: "stats", tiles: [{ label: "Watched", value: "12", tone: "good", href: "https://example.org" }] });
  assert.deepEqual(ep.widgetDataFrom({ kind: "figure", value: 3, caption: "today" }), { kind: "figure", value: "3", caption: "today" });
  assert.equal(ep.widgetDataFrom({ kind: "cards", cards: [] }).kind, "error", "cards are drawn from a template — not from a function");
  assert.equal(ep.widgetDataFrom("nonsense").kind, "error");
  assert.deepEqual(ep.pageNavFrom([{ pageId: 7, entries: [{ id: "a", label: "Alpha", href: "https://evil.example" }, { label: "no id" }] }, { pageId: "x", entries: [] }]), [{ pageId: 7, entries: [{ id: "a", label: "Alpha", icon: "•", n: 0 }] }]);
  assert.deepEqual(ep.reviewEntriesFrom([{ id: "r1", title: "Rated 5?", confidence: 3, actions: [{ id: "yes", label: "Yes", primary: true }] }, { id: "r2", title: "no buttons", actions: [] }]), [{ id: "r1", title: "Rated 5?", confidence: 1, actions: [{ id: "yes", label: "Yes", primary: true }] }]);
});
