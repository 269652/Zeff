import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { before } from "node:test";
import { setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

setupTempData();

/**
 * Agenda as an external plugin (zeff-plugins/plugins/agenda-ext): what tests/workspace-agenda.test.ts asks of the built-in, asked of the
 * port — its package made from the built-in's template, its screen the built-in's made of the view language alone (the sidebar from a
 * lambda, the new-note form a dialog running the package's flow), in your language; and the switch from the built-in.
 */
const skip = skipWithoutRepo("agenda-ext");

before(async () => {
  if (skip) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-agenda-ext-"));
  process.env.ZEFF_PLUGINS_DIR = dir;
  fs.cpSync(repoPlugin("agenda-ext"), path.join(dir, "agenda-ext"), { recursive: true });
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("agenda-ext", true);
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  setInstalled("agenda", false);
  await import("@/plugins/contributions");
  await import("@/plugins/workspace/server");
});

const pkgFile = () => JSON.parse(fs.readFileSync(path.join(process.env.ZEFF_PLUGINS_DIR!, "agenda-ext", "agenda.package.json"), "utf8"));

/** The timeline's entries in a drawn screen. */
function timeline(nodes: unknown[]): number {
  const find = (l: unknown[]): { c: unknown[] } | null => {
    for (const n of l as ({ t: string; c: unknown[] } | string)[]) {
      if (typeof n === "string") continue;
      if (n.t === "timeline") return n;
      const inner = find(n.c);
      if (inner) return inner;
    }
    return null;
  };
  return find(nodes)!.c.filter((x) => typeof x !== "string").length;
}

async function installed() {
  const life = await import("@/plugins/workspace/package-life");
  const store = await import("@/plugins/workspace/store");
  if (!life.getInstalled("agenda-ext")) await life.installTracked(pkgFile(), null, { allow: true });
  const inst = life.getInstalled("agenda-ext")!;
  const dbs = Object.values(inst.map).map((id) => store.getDatabase(id)).filter((d): d is NonNullable<typeof d> => !!d);
  const notes = dbs.find((d) => d.schema.dataType === "agenda")!;
  const projects = dbs.find((d) => d.schema.dataType !== "agenda")!;
  return { store, notes, projects, inst };
}

test("the package: projects and notes, the screen draws, its scopes pick the right notes — as the built-in's", { skip }, async () => {
  const { store, notes } = await installed();
  const { renderView } = await import("@/plugins/workspace/view-template");
  const d = store.rowsOf(notes.page.id)!;
  assert.equal(d.rows.length, 3);
  const view = d.schema.views[0];
  assert.equal(view.app, "template");
  const draw = (state: Record<string, string>) => renderView(view.template!, { rows: d.rows, props: d.schema.properties, titleName: d.schema.titleName, state, app: {}, db: { id: notes.page.id, title: "Notes" } });
  const all = draw({});
  assert.deepEqual(all.errors, []);
  assert.equal(timeline(all.nodes), 3, "all open notes");
  assert.equal(timeline(draw({ scope: "agenda" }).nodes), 2, "on the agenda");
  assert.equal(timeline(draw({ scope: "today" }).nodes), 1, "today");
  assert.equal(timeline(draw({ scope: "done" }).nodes), 0);
  const kinds: string[] = [];
  const walk = (l: unknown[]) => (l as ({ t: string; c: unknown[] } | string)[]).forEach((n) => typeof n !== "string" && (kinds.push(n.t), walk(n.c)));
  walk(all.nodes);
  assert.ok(kinds.includes("nav"));
  assert.ok(kinds.includes("dialog") || view.template!.includes("<dialog"), "the new-note form is a dialog");
  assert.ok(!view.template!.includes("<part"), "no part of code left");
});

test("the sidebar from the lambda: projects by category with their open notes; one whose notes are all done isn't offered", { skip }, async () => {
  const { store, notes, projects } = await installed();
  const { runOwnLambda } = await import("@/plugins/workspace/mcp-plugin-tools");
  const done = notes.schema.properties.find((p) => p.name === "Done")!;
  const project = notes.schema.properties.find((p) => p.type === "relation")!;
  const old = store.addRow(projects.page.id, { title: "Old project" });
  store.addRow(notes.page.id, { title: "Finished", cells: { [project.id]: [old], [done.id]: true } });
  const r = (await runOwnLambda("agenda-ext", "agenda.data", { db: notes.page.id, done: "Done" })) as { projects: { title: string; open: number; category: string }[]; events: unknown[]; projectOptions: string };
  assert.deepEqual(r.projects.map((p) => [p.title, p.open]), [["Getting started", 3]]);
  assert.equal(r.projects[0].category, "Personal");
  assert.deepEqual(r.events, [], "no calendar here");
  assert.equal(r.projectOptions, ":—, Getting started:Getting started");
});

test("the dialog's Save: a note with a range, a project, tags made when new, on the agenda, its text — through the package's flow", { skip }, async () => {
  const { store, notes } = await installed();
  const { runFlow } = await import("@/plugins/workspace/flows/engine");
  const r = await runFlow("agenda.add-note", {
    database: notes.page.id,
    title: "Trip to Rome",
    dated: "true",
    start: "2026-12-01",
    end: "2026-12-05",
    project: "Getting started",
    agenda: "true",
    pinned: "",
    tags: "Travel, Family",
    reminder: "2026-11-30",
    text: "- [ ] Book the flight",
    names: { date: "Date", project: "Project", agenda: "On the agenda", pinned: "Pinned", tags: "Tags", reminder: "Reminder" },
  });
  assert.equal(r.status, "done", r.error ?? "");
  const id = (r.output as { id: number }).id;
  const d = store.rowsOf(notes.page.id)!;
  const row = d.rows.find((x) => x.id === id)!;
  const prop = (name: string) => d.schema.properties.find((p) => p.name === name)!;
  assert.equal(row.title, "Trip to Rome");
  assert.deepEqual(row.cells[prop("Date").id], { start: "2026-12-01", end: "2026-12-05" });
  assert.equal((row.cells[prop("Project").id] as number[]).length, 1);
  assert.equal(row.cells[prop("On the agenda").id], true);
  assert.deepEqual((row.cells[prop("Tags").id] as string[]).map((o) => prop("Tags").options!.find((x) => x.id === o)!.name).sort(), ["Family", "Travel"], "new tags made");
  assert.match(JSON.stringify(store.getPage(id)!.content), /Book the flight/);
  // The flow may write only the package's own notes.
  const other = store.createPage({ title: "Elsewhere", kind: "database" });
  const r2 = await runFlow("agenda.add-note", { database: other, title: "x", names: {} });
  assert.equal(r2.status, "failed");
  assert.match(r2.error ?? "", /may not write/);
});

test("made in your language: German field names, the screen and the flow calling them so", { skip }, async () => {
  const { localizePackage } = await import("@/plugins/workspace/packages");
  const sh = await import("@/lib/i18n/shared");
  const de: Record<string, string> = { Date: "Datum", Project: "Projekt", Done: "Erledigt", "On the agenda": "Auf der Agenda", Pinned: "Angeheftet", Tags: "Schlagwörter", Reminder: "Erinnerung", People: "Personen", Note: "Notiz" };
  sh.setPluginStrings((l) => (l === "de" ? de : {}));
  (globalThis as { __zeffPluginLanguages?: unknown }).__zeffPluginLanguages = () => [{ code: "de" }];
  const srv = await import("@/lib/i18n/server");
  srv.setLanguage("de");
  try {
    const pkg = localizePackage(pkgFile());
    const notes = pkg.items.find((i) => i.schema?.dataType === "agenda")!;
    const names = notes.schema!.properties.map((p) => p.name);
    for (const n of ["Datum", "Projekt", "Erledigt", "Auf der Agenda", "Schlagwörter", "Erinnerung"]) assert.ok(names.includes(n), n);
    const tpl = notes.schema!.views.find((v) => v.app === "template")!.template!;
    assert.match(tpl, /where\('Erledigt', '!=', true\)/);
    assert.match(tpl, /"done": "Erledigt"/);
    assert.doesNotMatch(tpl, /'Done'/);
    const flow = pkg.items.find((i) => i.flow)!.flow as unknown as { nodes: unknown[] };
    assert.doesNotMatch(JSON.stringify(flow), /"Date"/);
    // It draws in German, without errors.
    const { renderView } = await import("@/plugins/workspace/view-template");
    const props = notes.schema!.properties;
    assert.deepEqual(renderView(tpl, { rows: [], props, titleName: notes.schema!.titleName, state: {}, app: {}, db: { id: 1, title: "Notizen" } }).errors, []);
  } finally {
    srv.setLanguage("en");
    sh.setPluginStrings(() => ({}));
  }
});

test("switching from the built-in: an Agenda you had gets the port's screen (yours kept), the flow may write it, the plugin on", { skip }, async () => {
  const { setInstalled, isInstalled } = await import("@/plugins/state");
  setInstalled("agenda", true);
  const { agendaPage } = await import("@/plugins/agenda/template");
  const store = await import("@/plugins/workspace/store");
  const root = agendaPage(null);
  const notes = store.tree().filter((p) => p.kind === "database" && p.parentId === root).map((p) => store.getDatabase(p.id)!).find((d) => d.schema.dataType === "agenda")!;
  // Yours: a line added to the screen.
  const mine = notes.schema.views.map((v) => (v.app === "agenda" ? { ...v, template: `${v.template}\n<muted>Mine</muted>` } : v));
  store.updateSchema(notes.page.id, { ...notes.schema, views: mine });
  const { switchAgendaToPlugin } = await import("@/plugins/agenda/to-plugin");
  const r = await switchAgendaToPlugin();
  assert.ok(r.agendas >= 1);
  const after = store.getDatabase(notes.page.id)!;
  const v = after.schema.views.find((x) => x.app === "template")!;
  assert.match(v.template!, /lambda="agenda\.data"/);
  assert.match(v.template!, /<dialog bind="adding"/);
  assert.match(v.template!, /<muted>Mine<\/muted>/, "what you changed stays");
  assert.equal(isInstalled("agenda"), false);
  const flow = (await import("@/plugins/workspace/flows/store")).flowByName("agenda.add-note")!;
  const w = flow.permissions.write;
  assert.ok(Array.isArray(w) && w.some((x) => x === notes.page.id || String(x).startsWith("@agenda-ext")), JSON.stringify(w));
  const { renderView } = await import("@/plugins/workspace/view-template");
  const d = store.rowsOf(notes.page.id)!;
  assert.deepEqual(renderView(v.template!, { rows: d.rows, props: d.schema.properties, titleName: d.schema.titleName, state: {}, app: {}, db: { id: notes.page.id, title: "Notes" } }).errors, []);
});
