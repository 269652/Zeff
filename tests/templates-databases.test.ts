import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";
import { skipWithoutRepo, loadRepoLanguages } from "./plugins-repo";

setupTempData();

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "todos", "cases"]) setInstalled(p, true);
  await import("@/plugins/contributions");
  // (German comes from its language pack in zeff-plugins)
  await loadRepoLanguages();
  (await import("@/lib/i18n/server")).setLanguage("de");
}

test("the database templates speak your language: the database, its fields, views, choices and examples — the cards name the fields as they are called", { skip: skipWithoutRepo("lang-de") }, async () => {
  await setup();
  const { fromTemplate } = await import("@/plugins/workspace/templates");
  const { getDatabase, rawRows } = await import("@/plugins/workspace/store");
  const tasks = getDatabase(await fromTemplate("tasks", null))!;
  assert.equal(tasks.page.title, "Aufgaben");
  assert.deepEqual(tasks.schema.properties.map((p) => p.name).slice(0, 4), ["Status", "Fällig", "Priorität", "Verantwortlich"]);
  assert.deepEqual(tasks.schema.properties[0].options!.map((o) => o.name), ["Nicht begonnen", "In Arbeit", "Erledigt"]);
  assert.equal(tasks.schema.views[0].type, "board", "the board first — where tasks move");
  assert.match(tasks.schema.views[0].card!, /\[Priorität\]/);
  assert.ok(rawRows(tasks.page.id).some((r) => r.title === "Zieh eine Karte nach „In Arbeit“"), "the examples in German");
  const { tree } = await import("@/plugins/workspace/store");
  const projects = await fromTemplate("projects", null);
  const dbs = [...(await Promise.all(["decisions", "reading-list", "contracts"].map((k) => fromTemplate(k, null)))), ...tree().filter((x) => x.parentId === projects && x.kind === "database").map((x) => x.id)];
  assert.equal(dbs.length, 5, "the projects' two databases below its page");
  for (const id of dbs) {
    const d = getDatabase(id)!;
    const words = [d.page.title, ...d.schema.properties.map((p) => p.name), ...d.schema.views.map((v) => v.name)].join(" ");
    assert.doesNotMatch(words, /\b(Table|Due|Owner|Decided on|Reading list|Projects|Per month|Cancel by|Goal)\b/, words);
  }
});

test("contracts: the running ones' sum a month under the table — published as Fixkosten (the Finances overview reads it) unless that name is taken", { skip: skipWithoutRepo("lang-de") }, async () => {
  await setup();
  // Without the Finances plugin: its example rows (with it the statements' recurring payments come instead).
  (await import("@/plugins/state")).setInstalled("finances", false);
  const { fromTemplate } = await import("@/plugins/workspace/templates");
  const { getDatabase } = await import("@/plugins/workspace/store");
  const id = await fromTemplate("contracts", null);
  const d = getDatabase(id)!;
  const monthly = d.schema.properties.find((p) => p.name === "Pro Monat")!;
  assert.equal(d.schema.views[0].calcs?.[monthly.id], "sum");
  await new Promise((r) => setTimeout(r, 50));
  const { namedValue } = await import("@/plugins/workspace/values");
  const v = namedValue("Fixkosten");
  assert.ok(v, "published");
  // A source beside the others (the first test made a contracts database too): each counts its running contracts.
  const mine = v!.sources.find((s) => s.dbId === id);
  assert.equal(mine?.value, 28.99, "15 + 13.99, the running contracts");
  assert.equal(v!.agg, "sum");
  assert.equal(v!.value, Math.round(v!.sources.reduce((n, s) => n + (s.value ?? 0), 0) * 100) / 100);
});

test("no debts or instalment plans of your own, with or without the Finances plugin (its debts database is the place)", { skip: skipWithoutRepo("lang-de") }, async () => {
  await setup();
  const { setInstalled } = await import("@/plugins/state");
  const { templateMetas } = await import("@/plugins/workspace/templates");
  for (const on of [true, false]) {
    setInstalled("finances", on);
    const keys = templateMetas().map((m) => m.key);
    assert.ok(!keys.includes("debts") && !keys.includes("installment-plan"), String(on));
  }
});

test("the gallery: where most start first; what was made of a template (and is still there) is offered to open — a page in the bin is not", { skip: skipWithoutRepo("lang-de") }, async () => {
  await setup();
  const { templateMetas, fromTemplate } = await import("@/plugins/workspace/templates");
  assert.deepEqual(
    templateMetas()
      .filter((m) => m.featured)
      .map((m) => m.key)
      .slice(0, 2),
    ["tasks", "projects"],
  );
  const a = await fromTemplate("decisions", null);
  const b = await fromTemplate("decisions", null);
  const made = () => templateMetas().find((m) => m.key === "decisions")!.made!.map((x) => x.id);
  assert.deepEqual(made().slice(-2), [a, b], "the newest last");
  (await import("@/plugins/workspace/store")).archivePage(b);
  assert.ok(made().includes(a) && !made().includes(b), "the one in the bin isn't offered");
});
