import assert from "node:assert/strict";
import test from "node:test";
import { formulaCompletions, formulaRefs } from "../src/plugins/workspace/formula";

test("a formula's references: each prop(\"…\") with where it stands — the same property once colour-wise, a broken text none", () => {
  const src = 'prop("Pro Monat") * 12 + prop(\'Gebühr\') - prop("Pro Monat")';
  const refs = formulaRefs(src);
  assert.deepEqual(
    refs.map((r) => [r.name, src.slice(r.from, r.to)]),
    [
      ["Pro Monat", 'prop("Pro Monat")'],
      ["Gebühr", "prop('Gebühr')"],
      ["Pro Monat", 'prop("Pro Monat")'],
    ],
  );
  assert.deepEqual(formulaRefs('prop("Unclosed'), [], "no throw");
  assert.deepEqual(formulaRefs("round(3.5)"), []);
});

test("completions at the caret: the functions a word starts, the property names inside prop(\"…\"), a property name typed bare as prop(\"…\")", () => {
  const props = ["Pro Monat", "Pro Jahr", "Status"];
  // A function begun.
  let c = formulaCompletions("1 + ro", 6, props);
  assert.deepEqual([c.from, c.to], [4, 6]);
  assert.deepEqual(
    c.items.map((i) => [i.kind, i.label, i.insert]),
    [["function", "round", "round("]],
  );
  // Inside prop(" — the properties, the rest of the name and the closing ") put in.
  c = formulaCompletions('prop("Pro', 9, props);
  assert.deepEqual(
    c.items.map((i) => [i.kind, i.label]),
    [
      ["property", "Pro Monat"],
      ["property", "Pro Jahr"],
    ],
  );
  assert.equal(c.items[0].insert, 'Pro Monat")');
  assert.equal('prop("Pro'.slice(0, c.from) + c.items[0].insert, 'prop("Pro Monat")');
  // A bare word that is a property's start: offered as prop("…") (after the functions).
  c = formulaCompletions("sta", 3, props);
  assert.ok(c.items.some((i) => i.kind === "property" && i.insert === 'prop("Status")'));
  // Nothing begun (after an operator, a number): nothing offered.
  assert.equal(formulaCompletions("1 + ", 4, props).items.length, 0);
  assert.equal(formulaCompletions("12", 2, props).items.length, 0);
});
