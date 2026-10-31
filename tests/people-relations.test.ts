import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// People relations: stored as structure, derived by the AI (fake Claude CLI answers) from the contexts.
const dir = setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;

test("relations: kept once, move along with a merge, go with the profile", async () => {
  const { createPerson, addRelation, relationsOf, mergePeople, deletePerson, getPerson } = await import("@/plugins/people/store");
  const mama = createPerson({ name: "Mama" });
  const johanna = createPerson({ name: "Johanna Roessler" });
  const lotte = createPerson({ name: "Lotte" });
  assert.equal(addRelation(mama, "Mutter", 0, "„Hey Mama“"), true);
  assert.equal(addRelation(mama, "Mutter", 0), false); // the same again: kept once
  assert.equal(addRelation(mama, "Mutter", mama), false); // not to themselves
  assert.equal(addRelation(mama, "Mutter", 999), false); // not to someone who isn't there
  assert.equal(addRelation(lotte, "Tochter", mama, "Lotte schreibt an Mama"), true);
  mergePeople(johanna, mama);
  assert.deepEqual(relationsOf(johanna).out.map((r) => [r.rel, r.otherId]), [["Mutter", 0]]);
  assert.deepEqual(relationsOf(johanna).in.map((r) => [r.personName, r.rel]), [["Lotte", "Tochter"]]);
  assert.deepEqual(relationsOf(lotte).out.map((r) => [r.rel, r.otherName]), [["Tochter", "Johanna Roessler"]]);
  deletePerson(johanna);
  assert.deepEqual(relationsOf(lotte).out, []);
  assert.equal(getPerson(lotte)?.name, "Lotte");
});

test("people matching: the AI's answer becomes aliases, merges and structured relations", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("llm", true);
  setInstalled("claude-cli", true);
  setInstalled("people", true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  const { createPerson, listPeople, relationsOf } = await import("@/plugins/people/store");
  const { addManualTodo } = await import("@/lib/todos/store");
  const { getDb, schema } = await import("@/db");
  const mama = createPerson({ name: "Mama" });
  const johanna = createPerson({ name: "Johanna Roessler" });
  const max = createPerson({ name: "Max Beispiel" });
  addManualTodo({ ticket: "", text: "Mama wegen dem Geburtstag anrufen" });
  // A message that names them: the context the prompt carries.
  getDb()
    .insert(schema.emails)
    .values({ key: "wa:Schwester|1", convId: "wa:Schwester", folder: "WhatsApp", fromName: "Ich", fromEmail: null, subject: "", preview: "Mama kommt am Sonntag", receivedAt: "2026-10-01T10:00", syncedAt: "2026-10-01T10:00" })
    .run();
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({
    aliases: [],
    people: [],
    merges: [{ keep: johanna, drop: mama }],
    relations: [
      { person: johanna, rel: "Mutter", other: 0, evidence: "„Mama kommt am Sonntag“ — die Todos nennen sie Mama" },
      { person: max, rel: "Sohn", other: johanna, evidence: "gleiche Familie" },
      { person: max, rel: "", other: 0, evidence: "leer" }, // no phrase: dropped
      { person: max, rel: "Kollege", other: 0, evidence: "" }, // no evidence: dropped
      { person: 999, rel: "Chef", other: 0, evidence: "nicht da" }, // no such person: dropped
    ],
  });
  const { normalizePeople } = await import("@/plugins/people/normalize");
  const r = await normalizePeople();
  assert.deepEqual([r.ok, r.merged, r.relations], [true, 1, 2]);
  assert.equal(listPeople().some((p) => p.name === "Mama"), false);
  assert.deepEqual(relationsOf(johanna).out.map((x) => [x.rel, x.otherId]), [["Mutter", 0]]);
  assert.deepEqual(relationsOf(max).out.map((x) => [x.rel, x.otherName]), [["Sohn", "Johanna Roessler"]]);
  // The prompt asked for relations and carried the mention as context.
  const prompt = fs.readFileSync(promptFile, "utf8");
  assert.match(prompt, /relations:/);
  assert.match(prompt, /erwähnt: Chat „Schwester“, ich: „Mama kommt am Sonntag“/);
});
