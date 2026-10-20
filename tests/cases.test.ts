import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

async function seed() {
  const { getDb, schema } = await import("@/db");
  const { createPerson, listPeople } = await import("@/plugins/people/store");
  const had = listPeople().find((p) => p.name === "Ulla Nathanael");
  if (had) return { ogv: had.id };
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["people", "todos", "cases"]) setInstalled(p, true);
  const db = getDb();
  const ogv = createPerson({ name: "Ulla Nathanael", emails: ["ogv.nathanael@gvjustiz.de"] });
  const mail = (key: string, subject: string, preview: string, days: number, from = "ogv.nathanael@gvjustiz.de", name = "ogv.nathanael") =>
    db.insert(schema.emails).values({ key, convId: `c-${key}`, syncedAt: ago(0), folder: "Posteingang", fromName: name, fromEmail: from, subject, preview, receivedAt: ago(days) } as never).run();
  mail("m1", "Mein Zeichen: DR II 810/26", "Sie erhalten in der Anlage ein für Sie bestimmtes Dokument. Das Verfahren 810/26 kann in Raten gezahlt werden.", 70);
  mail("m2", "11 DR II 1121/26", "Hier ist ein neues Verfahren eingegangen – Sparkasse Freiburg – Forderung ca. 3.650,00 €.", 28);
  mail("m3", "Re: Re: 11 DR II 1121/26", "Ich befinde mich bis 29.10.2026 nicht im Dienst.", 2);
  // Not a case: a calendar week and a fraction in a newsletter.
  mail("m4", "Angebote KW 43/26", "Nur diese Woche 3/4 Preis!", 3, "news@shop.example", "Shop");
  const doc = (sha: string, name: string, text: string, days: number) =>
    db.insert(schema.documents).values({ name, sha256: sha, kind: "pdf", status: "ready", file: `${sha}.pdf`, summary: `Schreiben der Obergerichtsvollzieherin, ${name}`, text, createdAt: ago(days), updatedAt: ago(days) } as never).run();
  doc("d1", "Mein Zeichen DR II 810 26.pdf", "U. Nathanael\nE-Mail: ogv.nathanael@gvjustiz.de\nIBAN: DE22 6609 0800 0007 7773 02\n11 DR II 810/26 Bitte bei Schreiben und Zahlungen angeben!", 30);
  doc("d2", "Mein Zeichen DR II 1121 26.pdf", "DR II 1121/26, Seite 1\nU. Nathanael\nSparkasse Freiburg 3.618,13 €", 1);
  db.insert(schema.todos).values({ ticket: "", text: "Restforderung 11,52 € (Az. DR II 810/26) heute überweisen", kind: "other", owner: "me", status: "open", source: "Mail", createdAt: ago(1), updatedAt: ago(1), refs: "[]" } as never).run();
  return { ogv };
}

test("cases: the case numbers in mails, letters and todos become cases — one per case however it is written, with its sources and the person on the other side", async () => {
  const { ogv } = await seed();
  const { caseKey } = await import("@/plugins/cases/shared");
  const { detectCases } = await import("@/plugins/cases/detect");
  const { listCases, sourcesOf } = await import("@/plugins/cases/store");
  assert.equal(caseKey("11 DR II 1121/26"), "DR II 1121/26");
  assert.equal(caseKey("dr  ii 810/26"), "DR II 810/26");

  const r = detectCases();
  assert.equal(r.created, 2);
  const cases = listCases();
  assert.deepEqual(cases.map((c) => c.key).sort(), ["DR II 1121/26", "DR II 810/26"], "no case for KW 43/26 or 3/4");
  const swr = cases.find((c) => c.key === "DR II 810/26")!;
  assert.deepEqual(sourcesOf(swr.id).map((s) => s.ref.split(":")[0]).sort(), ["doc", "mail", "todo"]);
  assert.equal(swr.personId, ogv);
  const spk = cases.find((c) => c.key === "DR II 1121/26")!;
  assert.equal(sourcesOf(spk.id).filter((s) => s.ref.startsWith("mail:")).length, 2);
  assert.equal(spk.lastAt.slice(0, 10), ago(1).slice(0, 10), "the newest source: the letter of yesterday");
  // The newest way it was written is kept for showing.
  assert.match(spk.label, /DR II 1121\/26/);

  // Again: nothing new.
  assert.deepEqual(detectCases(), { created: 0, linked: 0 });
});

test("cases: a case you set aside isn't made again; one closed stays closed until something new comes", async () => {
  await seed();
  const { detectCases } = await import("@/plugins/cases/detect");
  const { listCases, setCaseStatus, getCase } = await import("@/plugins/cases/store");
  detectCases();
  const spk = listCases().find((c) => c.key === "DR II 1121/26")!;
  setCaseStatus(spk.id, "ignored");
  detectCases();
  assert.equal(listCases().some((c) => c.key === "DR II 1121/26"), false, "ignored ones aren't listed");
  assert.equal(getCase(spk.id)?.status, "ignored");
});

test("cases: the AI sums a case up from its sources — the money checked (a wrong IBAN, a bad date or a negative amount dropped), the case number as purpose when none is said", async () => {
  await seed();
  const { detectCases } = await import("@/plugins/cases/detect");
  const { compileCases } = await import("@/plugins/cases/compile");
  const { listCases, getCase } = await import("@/plugins/cases/store");
  detectCases();
  const swr = listCases().find((c) => c.key === "DR II 810/26")!;
  const prompts: string[] = [];
  const r = await compileCases({
    ids: [swr.id],
    ask: async (p) => (
      prompts.push(p),
      { title: "Rundfunkbeitrag SWR — Zwangsvollstreckung", party: "SWR / Beitragsservice", summary: "Ratenplan 50 € monatlich, Rest 11,52 € offen.", total: 297.27, open: 11.52, installment: -50, next_due: "2026-11-15", next_what: "Rate 50 €", iban: "DE22 6609 0800 0007 7773 02", bic: "GENODE61BBB", payee: "Nathanael Dienstkonto", purpose: "", done: false }
    ),
  });
  assert.equal(r.compiled, 1);
  assert.match(prompts[0], /DR II 810\/26/);
  assert.match(prompts[0], /Restforderung 11,52/, "the todo is a source");
  assert.match(prompts[0], /DE22 6609/, "the letter's text is read");
  const s = getCase(swr.id)!.compiled!;
  assert.equal(s.title, "Rundfunkbeitrag SWR — Zwangsvollstreckung");
  assert.equal(s.open, 11.52);
  assert.equal(s.installment, null, "a negative amount is no amount");
  assert.equal(s.nextDue, "2026-11-15");
  assert.equal(s.purpose, "DR II 810/26");
  assert.equal(s.sources, 3);
  // Nothing new since: not asked again.
  const { setCaseStatus, caseByKey } = await import("@/plugins/cases/store");
  setCaseStatus(caseByKey("DR II 1121/26")!.id, "open"); // set aside in the test before
  const again: string[] = [];
  await compileCases({ ask: async (p) => (again.push(p), { title: "Sparkasse", party: "", summary: "", total: null, open: null, installment: null, next_due: "", next_what: "", iban: "", bic: "", payee: "", purpose: "", done: false }) });
  assert.equal(again.length, 1, "only the other case, which was never compiled");
  assert.doesNotMatch(again[0], /# Vorgang DR II 810\/26/);
  const bad = await compileCases({ ids: [swr.id], force: true, ask: async () => ({ title: "x", party: "", summary: "", total: null, open: null, installment: null, next_due: "15.11.", next_what: "", iban: "DE23 6609 0800 0007 7773 02", bic: "", payee: "", purpose: "", done: true }) });
  assert.equal(bad.compiled, 1);
  assert.equal(getCase(swr.id)!.compiled!.iban, "", "a wrong IBAN is dropped");
  assert.equal(getCase(swr.id)!.compiled!.nextDue, null);
});

test("cases: a row per case in the Workspace — the money and the next step as typed fields, closed when done", async () => {
  await seed();
  const { caseRecords, CASE_FIELDS } = await import("@/plugins/cases/workspace-source");
  const { caseByKey, updateCase } = await import("@/plugins/cases/store");
  const { checked } = await import("@/plugins/cases/compile");
  updateCase(caseByKey("DR II 810/26")!.id, { compiled: checked({ title: "Rundfunkbeitrag", open: 11.52, done: true }, "DR II 810/26", 3) });
  const recs = await caseRecords();
  const swr = recs.find((r) => r.key === "DR II 810/26")!;
  const field = (id: string) => swr.typed.find((f) => f.id === id)?.value;
  assert.equal(field(CASE_FIELDS.open), 11.52);
  assert.equal(field(CASE_FIELDS.person), "Ulla Nathanael");
  assert.equal(field(CASE_FIELDS.sources), 3);
  assert.equal(swr.status.group, "done", "the AI said done in the test before");
  assert.equal(swr.dataType, "cases");
});

test("cases: a person's page lists their letters (their address in them, or their name) and their cases", async () => {
  const { ogv } = await seed();
  const { personBundle } = await import("@/plugins/people/blocks");
  const b = await personBundle(ogv);
  assert.deepEqual(b.documents.map((d) => d.name).sort(), ["Mein Zeichen DR II 1121 26.pdf", "Mein Zeichen DR II 810 26.pdf"], "the second names her (Nathanael) without her address");
  assert.deepEqual(b.cases.map((c) => c.label).sort(), ["DR II 1121/26", "DR II 810/26"]);
  assert.equal(b.cases.find((c) => c.label === "DR II 810/26")?.open, 11.52);
});
