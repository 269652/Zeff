import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// The eval adapters on a temp database: golden sets derived from what "you" decided, each step run with a FAKE AI
// (deterministic — no real AI is ever called here), and the CLI end to end with a fake AI module.
const dir = setupTempData();
const now = new Date().toISOString();
const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

let seeded: Awaited<ReturnType<typeof seedAll>> | null = null;
async function seed() {
  return (seeded ??= await seedAll());
}

async function seedAll() {
  const { getDb, schema } = await import("@/db");
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["keep", "people", "auto-actions", "teams"]) setInstalled(id, true);
  const { attributed } = await import("@/lib/boards/activity");
  const { addMailTodo, addNoteTodo, setTodoStatus, addManualTodo } = await import("@/lib/boards/store");
  const db = getDb();
  const mail = (key: string, fromName: string, subject: string, preview = "Bitte kurz anschauen und Bescheid geben.") =>
    db.insert(schema.emails).values({ key, convId: key, folder: "Inbox", fromName, fromEmail: `${key}@x.de`, subject, preview, receivedAt: now, syncedAt: now } as never).run();
  mail("m1", "Anna Berg", "Fotos vom Samstag");
  mail("m2", "Newsletter", "Angebote der Woche");
  mail("m3", "Bob Kurz", "Rechnung März");
  mail("m4", "HR", "Erinnerung: Pflichtschulung Datenschutz", "Reminder: the mandatory training is overdue, please complete it.");
  const mt = (text: string, key: string) => attributed("lage:1", () => addMailTodo({ ticket: "", text, kind: "other", refs: [`mail:${key}`], runId: 1 }));
  const t1 = mt("Anna die Fotos vom Samstag schicken", "m1");
  const t2 = mt("Angebote der Woche lesen", "m2");
  mt("Rechnung März von Bob prüfen", "m3");
  const t4 = mt("Pflichtschulung Datenschutz absolvieren", "m4");
  attributed("you", () => setTodoStatus(t1.id, "done"));
  attributed("you", () => setTodoStatus(t2.id, "dismissed"));
  // a must-do mail stays a must-have, even dropped
  attributed("you", () => setTodoStatus(t4.id, "dismissed"));

  // Notes: one whose todo you did, one whose todo you dropped, one without a todo (not in the set).
  const k = await import("@/plugins/keep/boards");
  const b = k.createKeepBoard({ name: "Privat" });
  const n1 = k.createOwnNote(b, { title: "Auto", text: "- [ ] Reifen wechseln" });
  const n2 = k.createOwnNote(b, { title: "Ideen", text: "Vielleicht mal Töpfern ausprobieren" });
  k.createOwnNote(b, { title: "Rezept", text: "Mehl, Eier, Milch" });
  const nt = (text: string, ref: string) => attributed("keep", () => addNoteTodo({ ticket: "", text, kind: "task", refs: [ref], runId: null }));
  const a = nt("Reifenwechsel-Termin vereinbaren", n1.ref);
  const d = nt("Töpferkurs buchen", n2.ref);
  attributed("you", () => setTodoStatus(a.id, "done"));
  attributed("you", () => setTodoStatus(d.id, "dismissed"));

  // People: claims from Teams messages — confirmed, rejected, proposed.
  const { createPerson } = await import("@/plugins/people/store");
  const { addClaim, reviewClaim, claimsOf } = await import("@/plugins/people/graph");
  const julia = createPerson({ name: "Julia Freidank", aliases: ["Julia"] });
  const msg = (key: string, text: string, days: number) =>
    db.insert(schema.teamsMessages).values({ key, kind: "chat", conversationId: "x", messageId: key, sentAt: ago(days), html: "", text, link: "l", syncedAt: now, senderName: "Rico Clemen", place: "Devs" } as never).run();
  msg("t1", "Julia ist bei uns für die Abnahme und das Testing zuständig.", 3);
  msg("t2", "Julia hat heute schlechte Laune, glaube ich, lass sie in Ruhe.", 2);
  msg("t3", "Julia schickt die Liste bis Freitag an alle im Team.", 1);
  addClaim({ personId: julia, kind: "owns", text: "Verantwortet Abnahme und Testing", evidence: "für die Abnahme und das Testing zuständig", sourceRef: "teams:t1", confidence: 0.9 });
  addClaim({ personId: julia, kind: "fact", text: "Hat schlechte Laune heute", evidence: "schlechte Laune", sourceRef: "teams:t2", confidence: 0.6 });
  addClaim({ personId: julia, kind: "commitment", text: "Schickt die Liste bis Freitag", evidence: "schickt die Liste bis Freitag", sourceRef: "teams:t3", confidence: 0.9, direction: "theirs" });
  const cs = claimsOf(julia);
  reviewClaim(cs.find((c) => c.sourceRef === "teams:t1")!.id, "confirm");
  reviewClaim(cs.find((c) => c.sourceRef === "teams:t2")!.id, "reject");

  // Auto-actions: a done todo that had proposed actions, an open one with them, a dismissed one (not in the set).
  const mk = (text: string) => addManualTodo({ ticket: "", text });
  const x1 = mk("Anna nach dem Termin fragen");
  const x2 = mk("Bob an die Rechnung erinnern");
  const x3 = mk("Irgendwas Unwichtiges");
  const ops = (to: string) => JSON.stringify([{ type: "teams-message", to, body: "Hallo!" }]);
  const { eq } = await import("drizzle-orm");
  for (const [t, to] of [[x1, "Anna Berg"], [x2, "Bob Kurz"], [x3, "Wer"]] as const) db.update(schema.todos).set({ ops: ops(to), autoOpsWhy: "Weil." }).where(eq(schema.todos.id, t.id)).run();
  attributed("you", () => setTodoStatus(x1.id, "done"));
  attributed("you", () => setTodoStatus(x3.id, "dismissed"));
  return { julia, n1: n1.ref, n2: n2.ref, x1: x1.id, x2: x2.id, x3: x3.id };
}

const labelsOf = (cases: { labels: Record<string, string> }[]) => Object.assign({}, ...cases.map((c) => c.labels));

test("mail adapter: the mails behind the review's todos — done must, dropped negative, open open, must-do always must; run through the chain", async () => {
  await seed();
  const { mailAdapter } = await import("@/lib/evals/adapters/mail");
  const cases = await mailAdapter.build();
  assert.equal(cases.length, 1);
  assert.deepEqual(labelsOf(cases), { m1: "must", m2: "negative", m3: "open", m4: "must" });
  // The review's own todos aren't in the frozen context (they would give the answers away).
  assert.ok(!JSON.stringify(cases[0].input).includes("Anna die Fotos"));
  const prompts: string[] = [];
  const covered = await mailAdapter.run(cases[0], "MEINE ANWEISUNGEN", async (p, _s, o) => {
    prompts.push(p);
    assert.equal(o.task, "mail-todos");
    return { todos: [{ text: "Fotos schicken", refs: ["[mail:m1]"] }], updates: [{ refs: ["mail:m3"] }] };
  });
  assert.match(prompts[0], /^MEINE ANWEISUNGEN/);
  // m4 (must-do) by the safety net even though the AI skipped it
  assert.deepEqual([...covered].sort(), ["m1", "m3", "m4"]);
});

test("notes adapter: the notes behind the Notiz-Durchsicht's todos; a todo of the answer covers the notes it names", async () => {
  const s = await seed();
  const { notesAdapter } = await import("@/lib/evals/adapters/notes");
  const cases = await notesAdapter.build();
  assert.deepEqual(labelsOf(cases), { [s.n1]: "must", [s.n2]: "negative" });
  assert.match(JSON.stringify(cases[0].input), /Reifen wechseln/);
  assert.ok(!JSON.stringify(cases[0].input).includes("Mehl"), "a note no todo came of isn't in the set");
  const covered = await notesAdapter.run(cases[0], "X", async (p) => {
    assert.match(p, /# Notizen/);
    return { todos: [{ text: "Reifen", refs: [s.n1.slice(5)] }, { text: "", refs: [s.n2] }] };
  });
  assert.deepEqual([...covered], [s.n1], "a bare Keep id is the note; a todo without text covers nothing");
});

test("people adapter: claims you confirmed are must-haves, rejected negatives, proposed open — keyed by person and message; known claims of the case are not shown", async () => {
  const s = await seed();
  const { peopleAdapter } = await import("@/lib/evals/adapters/people");
  const cases = await peopleAdapter.build();
  assert.deepEqual(labelsOf(cases), { [`${s.julia}@teams:t1`]: "must", [`${s.julia}@teams:t2`]: "negative", [`${s.julia}@teams:t3`]: "open" });
  const input = JSON.stringify(cases[0].input);
  assert.ok(!input.includes("Verantwortet Abnahme"), "what the case is about isn't 'known' already");
  assert.ok(!input.includes("schlechte Laune heute"), "nor rejected");
  const covered = await peopleAdapter.run(cases[0], "X", async (p, _s, o) => {
    assert.equal(o.task, "people-normalize");
    const id = (snippet: string) => new RegExp(String.raw`\[(m\d+)\][^\n]*${snippet}`).exec(p)?.[1];
    return {
      claims: [
        { person: s.julia, kind: "owns", text: "Verantwortet Abnahme und Testing", evidence: "zuständig", source: id("Abnahme"), confidence: 0.9 },
        { person: s.julia, kind: "fact", text: "Ohne Zitat geht nichts", evidence: "", source: id("Liste"), confidence: 0.9 },
      ],
      links: [],
    };
  });
  assert.deepEqual([...covered], [`${s.julia}@teams:t1`], "only what passes the step's own checks counts");
});

test("auto-actions adapter: a done todo with proposed actions must get actions again, an open one is open, kinds per todo; dismissed ones are out", async () => {
  const s = await seed();
  const { autoActionsAdapter } = await import("@/lib/evals/adapters/auto-actions");
  const cases = await autoActionsAdapter.build();
  assert.deepEqual(labelsOf(cases), {
    [`todo:${s.x1}`]: "must",
    [`todo:${s.x1}:teams-message`]: "open",
    [`todo:${s.x2}`]: "open",
    [`todo:${s.x2}:teams-message`]: "open",
  });
  const covered = await autoActionsAdapter.run(cases[0], "Ich bin {{me}}, heute {{today}}.", async (p, _s, o) => {
    assert.equal(o.task, "auto-actions");
    assert.doesNotMatch(p, /\{\{me\}\}|\{\{today\}\}/);
    assert.match(p, new RegExp(`Todo \\[${s.x1}\\]`));
    return { todos: [{ id: s.x1, ops: [{ type: "teams-message", to: "Anna Berg", body: "Hallo Anna" }], why: "x" }, { id: s.x2, ops: [{ type: "teams-message", to: "", body: "" }], why: "kaputt" }] };
  });
  assert.deepEqual([...covered].sort(), [`todo:${s.x1}`, `todo:${s.x1}:teams-message`], "an action that fails its own rules is no action");
});

test("golden sets: built for every step into <dir>/<account>/<step>.json, read back; a step without cases writes none", async () => {
  await seed();
  const { buildGoldenSets } = await import("@/lib/evals/build");
  const { EVAL_ADAPTERS } = await import("@/lib/evals");
  const { readGolden } = await import("@/lib/evals/golden");
  const out = path.join(dir, "evals");
  const r = await buildGoldenSets({ adapters: EVAL_ADAPTERS, dir: out, account: "default", sources: [{ name: "ledger", verdicts: (step) => (step === "mail" ? [{ step, item: "m3", label: "must" }] : []) }] });
  assert.deepEqual(r.map((x) => [x.step, x.cases > 0]).sort(), [["auto-actions", true], ["mail", true], ["notes", true], ["people", true]]);
  const mail = readGolden(path.join(out, "default", "mail.json"))!;
  assert.equal(mail.cases[0].labels.m3, "must", "the ledger's verdict over the derived one");
  assert.deepEqual(mail.sources, ["rules", "ledger"]);
});

test("CLI: npm run eval -- mail with a golden set and a fake AI — a mail lost after the change exits 1, without one 0", async () => {
  await seed();
  const { mailAdapter } = await import("@/lib/evals/adapters/mail");
  const { writeGolden } = await import("@/lib/evals/golden");
  const fixtures = path.join(dir, "fx");
  writeGolden(path.join(fixtures, "default", "mail.json"), { step: "mail", account: "default", cases: await mailAdapter.build() });
  // The fake AI: the first call ("before") finds m1 and m3; later calls only m1 — unless told not to lose anything.
  const fake = path.join(dir, "fake-ai.mjs");
  fs.writeFileSync(
    fake,
    `let n = 0;\nexport default async function ask() {\n  n++;\n  const keep = process.env.FAKE_KEEP === "1" || n === 1;\n  return { todos: [{ text: "x", refs: keep ? ["mail:m1", "mail:m3"] : ["mail:m1"] }] };\n}\n`,
  );
  const run = (env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ["--import", "tsx", path.join(ROOT, "scripts", "eval.mts"), "mail", "--account", "default", "--runs", "1", "--fixtures", fixtures, "--fake", fake], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, ZEFF_EVAL_DB_ROOT: dir, ...env },
    });
  const lost = run();
  assert.equal(lost.status, 1, lost.stdout + lost.stderr);
  assert.match(lost.stdout, /VERLOREN \(1\)/);
  assert.match(lost.stdout, /Bob Kurz/);
  const fine = run({ FAKE_KEEP: "1" });
  assert.equal(fine.status, 0, fine.stdout + fine.stderr);
  assert.match(fine.stdout, /Nichts verloren/);
  // A dry run says what it would cost and calls nothing.
  const dry = spawnSync(process.execPath, ["--import", "tsx", path.join(ROOT, "scripts", "eval.mts"), "mail", "--account", "default", "--fixtures", fixtures, "--dry-run"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ZEFF_EVAL_DB_ROOT: dir } });
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /3 KI-Aufrufe/);
});
