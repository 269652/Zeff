import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const IBAN = "DE22 6609 0800 0007 7773 02";
const TODO = "Restforderung 11,52 € (Az. DR II 810/26) heute auf das Dienstkonto der Gerichtsvollzieherin überweisen";
const todo = (text: string, more: Partial<{ note: string | null; userNotes: { at: string; text: string }[]; knowledge: unknown }> = {}) =>
  ({ text, note: null, userNotes: [], knowledge: null, ...more }) as Parameters<typeof import("@/lib/girocode-todo").paymentForTodo>[0];

test("girocode for a todo: the IBAN in its text or notes — the recipient named beside it, the amount and the case number as the purpose", async () => {
  const { paymentForTodo } = await import("@/lib/girocode-todo");
  assert.deepEqual(paymentForTodo(todo(`${TODO}. Empfänger Nathanael Dienstkonto, IBAN ${IBAN}, BIC GENODE61BBB`)), {
    name: "Nathanael Dienstkonto",
    iban: IBAN,
    bic: "GENODE61BBB",
    amount: 11.52,
    purpose: "DR II 810/26",
    via: "",
  });
  // In a note of yours: the same; no case number — the todo's text is the purpose.
  assert.deepEqual(paymentForTodo(todo("Miete Oktober 750 € überweisen", { userNotes: [{ at: "2026-10-01", text: `Kontoinhaber: Hans Vermieter; IBAN ${IBAN}` }] })), {
    name: "Hans Vermieter",
    iban: IBAN,
    amount: 750,
    purpose: "Miete Oktober 750 € überweisen",
    via: "",
  });
  // An IBAN with a wrong check digit, or none and nobody to pay: nothing.
  assert.equal(paymentForTodo(todo(`${TODO}. Empfänger X, IBAN DE23 6609 0800 0007 7773 02`)), null);
  assert.equal(paymentForTodo(todo(TODO)), null);
});

test("girocode for a todo: the bank account of a person it names, or whose case number it carries", async () => {
  const { paymentForTodo } = await import("@/lib/girocode-todo");
  const ulla = {
    name: "Ulla Nathanael",
    details: [
      { key: "iban", value: IBAN },
      { key: "bic", value: "GENODE61BBB" },
      { key: "bank", value: "BBBank Karlsruhe" },
    ],
    texts: ["Dienstkonto für Zahlungen: Empfänger Nathanael Dienstkonto, IBAN DE22 6609 0800 0007 7773 02, BIC GENODE61BBB", "Verfahren DR II 810/26: Restforderung offen"],
    names: (t: string) => /Nathanael/.test(t),
  };
  const other = { name: "Hans Vermieter", details: [{ key: "iban", value: "DE89 3704 0044 0532 0130 00" }], texts: [], names: (t: string) => /Vermieter/.test(t) };
  const expected = { name: "Nathanael Dienstkonto", iban: IBAN, bic: "GENODE61BBB", bank: "BBBank Karlsruhe", amount: 11.52, purpose: "DR II 810/26", via: "Ulla Nathanael" };
  // The case number: hers.
  assert.deepEqual(paymentForTodo(todo(TODO), [other, ulla]), expected);
  // Named in the todo.
  assert.deepEqual(paymentForTodo(todo("Frau Nathanael 300 € überweisen"), [other, ulla]), { ...expected, amount: 300, purpose: "Frau Nathanael 300 € überweisen" });
  // An amount isn't needed.
  assert.equal(paymentForTodo(todo("Nathanael zurückrufen"), [ulla])?.amount, undefined);
});

test("girocode for a todo: an account the knowledge it was given names — the entity is the recipient", async () => {
  const { paymentForTodo } = await import("@/lib/girocode-todo");
  const knowledge = { at: "", pages: [], entities: [{ id: 1, name: "Gerichtsvollzieherin Nathanael", type: "person", summary: `Obergerichtsvollzieherin in Freiburg; Dienstkonto IBAN ${IBAN}`, aliases: [], pages: 1, related: [] }] };
  assert.deepEqual(paymentForTodo(todo(TODO, { knowledge })), { name: "Gerichtsvollzieherin Nathanael", iban: IBAN, amount: 11.52, purpose: "DR II 810/26", via: "Gerichtsvollzieherin Nathanael" });
});

test("girocode for a todo: the people of the People plugin as payees — their details and what was said about them", async () => {
  const { createPerson } = await import("@/plugins/people/store");
  const { addClaim } = await import("@/plugins/people/graph");
  const { syncDetails, payees } = await import("@/plugins/people/details");
  const { paymentForTodo } = await import("@/lib/girocode-todo");
  const p = createPerson({ name: "Ulla Nathanael" });
  createPerson({ name: "Ohne Konto" });
  addClaim({ personId: p, kind: "fact", text: `Dienstkonto für Zahlungen: Empfänger Nathanael Dienstkonto, IBAN ${IBAN}, BIC GENODE61BBB, Bank BBBank Karlsruhe.`, evidence: IBAN, sourceRef: "doc:1", confidence: 0.9 });
  addClaim({ personId: p, kind: "commitment", text: "Verfahren DR II 810/26: Restforderung begleichen", evidence: "DR II 810/26", sourceRef: "doc:1", confidence: 0.9 });
  syncDetails(p);
  const list = payees();
  assert.deepEqual(list.map((x) => x.name), ["Ulla Nathanael"]);
  assert.deepEqual(paymentForTodo(todo(TODO), list), { name: "Nathanael Dienstkonto", iban: IBAN, bic: "GENODE61BBB", bank: "BBBank Karlsruhe", amount: 11.52, purpose: "DR II 810/26", via: "Ulla Nathanael" });
});
