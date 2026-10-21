import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["people", "todos", "cases"]) setInstalled(p, true);
}

test("contacts placed by the AI: person or organisation and their circle, from what Zeff knows of them — asked once, yours stay", async () => {
  await setup();
  const { createPerson, getPerson, setKind, addRelation } = await import("@/plugins/people/store");
  const { classifyContacts } = await import("@/plugins/people/classify");
  const spk = createPerson({ name: "Volksbank Lahr" });
  const lotte = createPerson({ name: "Lotte" });
  addRelation(lotte, "meine Schwester", 0, "", "manual");
  const chris = createPerson({ name: "Chris" });
  const prompts: string[] = [];
  const ask = async (prompt: string) => {
    prompts.push(prompt);
    const ids = [...prompt.matchAll(/^## (\d+): /gm)].map((m) => Number(m[1]));
    const said: Record<number, { kind: string; circle: string }> = { [spk]: { kind: "organization", circle: "authorities" }, [lotte]: { kind: "person", circle: "family" }, [chris]: { kind: "person", circle: "" } };
    return { people: ids.map((id) => ({ id, ...said[id] })) };
  };
  const r = await classifyContacts({ ask });
  assert.equal(r.asked, 3);
  assert.equal(prompts.length, 1, "all in one call");
  assert.match(prompts[0], /meine Schwester/, "what Zeff knows goes along");
  assert.equal(getPerson(spk)!.kind, "organization");
  assert.equal(getPerson(spk)!.circle, "authorities");
  assert.equal(getPerson(lotte)!.circle, "family");
  assert.equal(getPerson(chris)!.circle, "", "unclear: no circle");
  assert.equal((await classifyContacts({ ask })).asked, 0, "asked once — an unclear one too");
  setKind(spk, "person", "manual");
  await classifyContacts({ ask, force: true });
  assert.equal(getPerson(spk)!.kind, "person", "yours stays");
});

test("a case's parties as the AI names them when it sums the case up: the creditor (found, or made as it said), who collects it, who is paid — the creditor's cases and the collector's both list it; a case summed up before is summed up once more", async () => {
  await setup();
  const { createPerson, listPeople, getPerson } = await import("@/plugins/people/store");
  const { ensureCase, updateCase, addSource, casesOfPerson } = await import("@/plugins/cases/store");
  const { checked, compileCases } = await import("@/plugins/cases/compile");
  const { partiesOf, setParty } = await import("@/plugins/cases/parties");
  const ulla = createPerson({ name: "Ulrike Nathanael", aliases: ["Nathanael"] });
  const c1 = ensureCase("DR II 1121/26", "DR II 1121/26", new Date().toISOString()).id;
  addSource(c1, { ref: "mail:x1", kind: "mail", at: new Date().toISOString(), title: "Ratenplan" });
  // Summed up before the creditor was asked for.
  const old = checked({ title: "Sparkasse – Ratenplan", party: "Sparkasse Freiburg-Nördlicher Breisgau (Gerichtsvollzieherin Nathanael, AG Freiburg)", payee: "Nathanael Dienstkonto", open: 3618.13 }, "DR II 1121/26", 1);
  delete old.creditor;
  delete old.collector;
  updateCase(c1, { personId: ulla, compiled: old });
  let asked = 0;
  const answer = { title: "Sparkasse – Ratenplan", party: "Sparkasse Freiburg-Nördlicher Breisgau", creditor: "Sparkasse Freiburg-Nördlicher Breisgau", creditor_kind: "organization", collector: "Gerichtsvollzieherin Nathanael, AG Freiburg", collector_kind: "person", summary: "Ratenplan.", total: 3618.13, open: 3618.13, installment: 300, next_due: day(10), next_what: "Rate 300 €", iban: "", bic: "", payee: "Nathanael Dienstkonto", purpose: "", done: false };
  await compileCases({ ask: async () => (asked++, answer) });
  assert.equal(asked, 1, "summed up once more");
  const p1 = partiesOf(c1);
  assert.equal(p1.creditor?.name, "Sparkasse Freiburg-Nördlicher Breisgau");
  assert.equal(getPerson(p1.creditor!.personId)!.kind, "organization", "as the AI said");
  assert.equal(getPerson(p1.creditor!.personId)!.circle, "authorities");
  assert.equal(p1.collector?.personId, ulla, "found by her alias in the name");
  assert.equal(p1.payee?.personId, ulla, "her account");
  await compileCases({ ask: async () => (asked++, answer) });
  assert.equal(asked, 1, "not again without new sources");
  assert.equal(listPeople().filter((p) => p.name.startsWith("Sparkasse")).length, 1, "made once");
  assert.deepEqual(casesOfPerson(p1.creditor!.personId).map((c) => c.id), [c1]);
  assert.deepEqual(casesOfPerson(ulla).map((c) => c.id), [c1]);
  // Yours stays: a creditor you chose isn't taken back.
  const other = createPerson({ name: "Sparkasse Hochrhein" });
  setParty(c1, "creditor", other, "manual");
  await compileCases({ ask: async () => answer, ids: [c1], force: true });
  assert.equal(partiesOf(c1).creditor?.personId, other);
});

test("a debt of your own (no case number): to whom, how much, by when — kept as you wrote it, the AI never sums it up anew", async () => {
  await setup();
  const { createPerson, getPerson } = await import("@/plugins/people/store");
  const { createDebt, partiesOf, updateDebt } = await import("@/plugins/cases/parties");
  const { getCase } = await import("@/plugins/cases/store");
  const { compileCases } = await import("@/plugins/cases/compile");
  const chris = createPerson({ name: "Chris Ballhaus" });
  const id = createDebt({ title: "Geliehen für die Reparatur", creditorId: chris, amount: 150, due: day(30), installment: null });
  const c = getCase(id)!;
  assert.match(c.key, /^MAN-\d+$/);
  assert.equal(c.compiled?.open, 150);
  assert.equal(c.compiled?.total, 150);
  assert.equal(c.compiled?.nextDue, day(30));
  assert.equal(c.compiled?.manual, true);
  assert.equal(partiesOf(id).creditor?.personId, chris);
  let asked = 0;
  await compileCases({ ask: async () => (asked++, {}), ids: [id], force: true });
  assert.equal(asked, 0, "not summed up by the AI");
  updateDebt(id, { open: 100 });
  assert.equal(getCase(id)!.compiled?.open, 100);
  // A new creditor by its name: made, a person or an organisation as you said.
  const id2 = createDebt({ title: "Stromrechnung", creditorName: "Badenova AG & Co. KG", creditorKind: "organization", amount: 186.83, due: null, installment: null });
  const b = partiesOf(id2).creditor!;
  assert.equal(b.name, "Badenova AG & Co. KG");
  assert.equal(getPerson(b.personId)!.kind, "organization");
});

test("debts from your promises: a commitment of yours with an amount is offered as a debt to that person — once taken, not again", async () => {
  await setup();
  const { createPerson } = await import("@/plugins/people/store");
  const { addClaim } = await import("@/plugins/people/graph");
  const { debtSuggestions, createDebtFromClaim } = await import("@/plugins/cases/parties");
  const jo = createPerson({ name: "Johanna Roessler" });
  addClaim({ personId: jo, kind: "commitment", text: "Ich habe Johanna zugesagt, ihr die erbetenen 200€ in 9 Tagen zurückzuüberweisen.", direction: "mine", due: day(9), confidence: 0.9 });
  addClaim({ personId: jo, kind: "commitment", text: "Ich rufe sie morgen an.", direction: "mine", confidence: 0.9 });
  addClaim({ personId: jo, kind: "commitment", text: "Sie zahlt mir 50 € zurück.", direction: "theirs", confidence: 0.9 });
  const s = debtSuggestions().filter((x) => x.personId === jo);
  assert.equal(s.length, 1);
  assert.equal(s[0].amount, 200);
  assert.equal(s[0].due, day(9));
  const id = createDebtFromClaim(s[0].claimId);
  const { getCase } = await import("@/plugins/cases/store");
  assert.equal(getCase(id)!.compiled?.open, 200);
  assert.equal(debtSuggestions().filter((x) => x.personId === jo).length, 0, "taken");
});

test("the debt overview by creditor: the creditor's name, who collects it; your own debts without a case number", async () => {
  await setup();
  const { debtOverview } = await import("@/plugins/cases/bank");
  const rows = debtOverview({ today: day(0) }).rows;
  const spk = rows.find((r) => r.caseNumber === "DR II 1121/26")!;
  assert.equal(spk.creditor, "Sparkasse Hochrhein", "the one you chose");
  assert.equal(spk.collector, "Ulrike Nathanael");
  const chris = rows.find((r) => r.creditor === "Chris Ballhaus")!;
  assert.equal(chris.open, 100);
  assert.equal(chris.manual, true);
  assert.equal(chris.caseNumber, "");
});

test("no promise offered as a debt that is a case already: its case number in the text, or its person a party of a running case", async () => {
  await setup();
  const { createPerson } = await import("@/plugins/people/store");
  const { addClaim } = await import("@/plugins/people/graph");
  const { debtSuggestions } = await import("@/plugins/cases/parties");
  const { listPeople } = await import("@/plugins/people/store");
  const ulla = listPeople().find((p) => p.name === "Ulrike Nathanael")!.id;
  addClaim({ personId: ulla, kind: "commitment", text: "Ich soll im Verfahren DR II 1121/26 die erste Rate von 300 € zahlen.", direction: "mine", confidence: 0.9 });
  addClaim({ personId: ulla, kind: "commitment", text: "Ich soll ihr die restlichen 11,52 € überweisen.", direction: "mine", confidence: 0.9 });
  const max = createPerson({ name: "Max Muster" });
  addClaim({ personId: max, kind: "commitment", text: "Ich gebe Max die 60 € fürs Konzert zurück.", direction: "mine", confidence: 0.9 });
  const names = debtSuggestions().map((s) => s.name);
  assert.ok(!names.includes("Ulrike Nathanael"), "her cases cover them");
  assert.ok(names.includes("Max Muster"));
});

test("a case's money corrected by you — total, open, instalment, due — stays over what the AI sums up later", async () => {
  await setup();
  const { caseByKey, getCase, addSource } = await import("@/plugins/cases/store");
  const { editCaseMoney } = await import("@/plugins/cases/parties");
  const { compileCases } = await import("@/plugins/cases/compile");
  const c = caseByKey("DR II 1121/26")!;
  editCaseMoney(c.id, { open: 3318.13, installment: 250 });
  assert.equal(getCase(c.id)!.compiled?.open, 3318.13);
  assert.equal(getCase(c.id)!.compiled?.installment, 250);
  addSource(c.id, { ref: "mail:x2", kind: "mail", at: new Date().toISOString(), title: "Neuer Brief" });
  await compileCases({ ids: [c.id], ask: async () => ({ title: "Sparkasse", creditor: "Sparkasse Hochrhein", summary: "x", total: 3618.13, open: 3618.13, installment: 300, next_due: "", next_what: "", iban: "", bic: "", payee: "", purpose: "", done: false }) });
  assert.equal(getCase(c.id)!.compiled?.open, 3318.13, "yours stays");
  assert.equal(getCase(c.id)!.compiled?.total, 3618.13, "the rest is the AI's");
  editCaseMoney(c.id, { open: null });
  assert.equal(getCase(c.id)!.compiled?.open, 3618.13, "taken back: the AI's again");
});
