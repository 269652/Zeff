import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

/**
 * Rules as data: a database of rules (when / then) a pipeline step applies to the records it reads — drop them, set a field,
 * hand the record to an agent as a job. Rules are rows: written by you, by the AI over the MCP, paused by a tick. Jobs are
 * rows of a jobs database; a rule makes one job per record, once.
 */
setupTempData();

async function setup() {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { createRulesDatabase, addRule } = await import("@/plugins/workspace/rules");
  const { createJobsDatabase } = await import("@/plugins/workspace/jobs");
  const rules = createRulesDatabase(null);
  const jobs = createJobsDatabase(null);
  // The records come from a database of mails (a plain one: title, a "Absender" and a "Betreff" text).
  const inbox = w.createPage({
    kind: "database",
    title: "Eingang",
    schema: { titleName: "Betreff", properties: [{ id: "p_from", name: "Absender", type: "text" }], views: [m.newView("Table")] },
  });
  w.addRow(inbox, { title: "Newsletter Oktober", cells: { p_from: "news@example.com" } });
  w.addRow(inbox, { title: "Bitte Freigabe bis heute", cells: { p_from: "chef@example.com" } });
  w.addRow(inbox, { title: "Pflichtschulung Datenschutz", cells: { p_from: "hr@example.com" } });
  const out = w.createPage({
    kind: "database",
    title: "Gefiltert",
    schema: {
      titleName: "Betreff",
      properties: [],
      views: [m.newView("Table")],
      pipeline: { steps: [{ id: "s1", kind: "source", from: "database", dbId: inbox }, { id: "s2", kind: "rules", dbId: rules, to: jobs }] },
    },
  });
  return { w, m, rules, jobs, inbox, out, addRule };
}

test("a rules step: records dropped, a field set, a job made once per record — paused rules do nothing", async () => {
  const { w, rules, jobs, out, addRule } = await setup();
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  addRule(rules, { title: "Newsletter weg", field: "Absender", op: "enthält", value: "news@", then: "Ausschließen", why: "Newsletter lese ich nicht" });
  addRule(rules, { title: "Chef ist wichtig", field: "Absender", op: "enthält", value: "chef@", then: "Feld setzen", target: "Wichtig", set: "ja" });
  addRule(rules, { title: "Schulungen als Auftrag", field: "Betreff", op: "enthält", value: "Pflichtschulung", then: "Auftrag anlegen", target: "Erledige die Pflichtschulung: {{title}}" });
  addRule(rules, { title: "Pausiert", field: "Absender", op: "enthält", value: "hr@", then: "Ausschließen", paused: true });

  const r = await runPipeline(out, { ai: false });
  assert.equal(r.ok, true, r.error);
  const d = w.getDatabase(out)!;
  const rows = w.rawRows(out);
  assert.deepEqual(rows.map((x) => x.title).sort(), ["Bitte Freigabe bis heute", "Pflichtschulung Datenschutz"], "the newsletter is dropped by its rule; the paused rule drops nothing");
  const wichtig = d.schema.properties.find((p) => p.name === "Wichtig")!;
  assert.equal(rows.find((x) => x.title.startsWith("Bitte"))!.cells[wichtig.id], "ja", "a field set by a rule");
  assert.equal(rows.find((x) => x.title.startsWith("Pflicht"))!.cells[wichtig.id], undefined);

  const made = w.rawRows(jobs);
  assert.equal(made.length, 1, "one job for the one record the rule matched");
  const job = made[0];
  assert.equal(job.title, "Erledige die Pflichtschulung: Pflichtschulung Datenschutz");
  const status = w.getDatabase(jobs)!.schema.properties.find((p) => p.id === "job_status")!;
  assert.equal(status.options?.find((o) => o.id === job.cells.job_status)?.name, "Eingang", "waiting for you to start it");
  assert.match(String(job.cells.job_by), /Schulungen als Auftrag/, "which rule made it");

  await runPipeline(out, { ai: false });
  assert.equal(w.rawRows(jobs).length, 1, "a second run makes no second job");
});

test("a rule without a field looks at the whole record; the first rule that drops a record ends its rules", async () => {
  const { w, rules, out, addRule } = await setup();
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  addRule(rules, { title: "Alles mit Freigabe", op: "enthält", value: "freigabe", then: "Feld setzen", target: "Art", set: "Freigabe", prio: 2 });
  addRule(rules, { title: "Newsletter weg", field: "Absender", op: "enthält", value: "news@", then: "Ausschließen", prio: 1 });
  addRule(rules, { title: "Danach nie", field: "Absender", op: "enthält", value: "news@", then: "Feld setzen", target: "Art", set: "Newsletter", prio: 3 });
  await runPipeline(out, { ai: false });
  const d = w.getDatabase(out)!;
  const art = d.schema.properties.find((p) => p.name === "Art")!;
  const byTitle = Object.fromEntries(w.rawRows(out).map((x) => [x.title, x.cells[art.id]]));
  assert.equal(byTitle["Bitte Freigabe bis heute"], "Freigabe", "no field: the record's text as a whole");
  assert.equal(byTitle["Newsletter Oktober"], undefined, "dropped by priority 1: rule 3 never saw it");
});

test("the pipeline and schema keep the rules step and the database flags", async () => {
  const m = await import("@/plugins/workspace/model");
  const p = m.normalizePipeline({ steps: [{ id: "a", kind: "rules", dbId: 4, to: 5 }, { id: "b", kind: "rules" }] });
  assert.deepEqual(p.steps.map((s) => [s.kind, s.dbId, s.to]), [["rules", 4, 5]], "a rules step needs its database");
  const s = m.normalizeSchema({ titleName: "N", properties: [], views: [], rules: true, jobs: true });
  assert.deepEqual([s.rules, s.jobs], [true, true]);
});

test("rules tried: per rule, the records it would hit and what it would do — in order (a dropped record meets no later rule), nothing written", async () => {
  const { w, rules, jobs, addRule } = await setup();
  addRule(rules, { title: "Newsletter weg", field: "Absender", op: "enthält", value: "news@", then: "Ausschließen", prio: 1 });
  addRule(rules, { title: "Danach nie", field: "Absender", op: "enthält", value: "news@", then: "Feld setzen", target: "Art", set: "Newsletter", prio: 2 });
  addRule(rules, { title: "Schulungen als Auftrag", field: "Betreff", op: "enthält", value: "Pflichtschulung", then: "Auftrag anlegen", target: "Erledige: {{title}}", prio: 3 });
  const { tryRulesDatabase } = await import("@/plugins/workspace/rules");
  const tried = await tryRulesDatabase(rules);
  const by = Object.fromEntries(tried.rules.map((r) => [r.title, r.hits.map((h) => h.title)]));
  assert.deepEqual(by["Newsletter weg"], ["Newsletter Oktober"]);
  assert.deepEqual(by["Danach nie"], [], "dropped before: no later rule meets it");
  assert.deepEqual(by["Schulungen als Auftrag"], ["Pflichtschulung Datenschutz"]);
  assert.ok(tried.records >= 3, "the records the pipelines read");
  assert.equal(w.rawRows(jobs).length, 0, "no job made");
});
