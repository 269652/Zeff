import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A person under all their names: aliases, unique name parts ("Herr Kruger"), the genitive — a shared part names no one. */
test("people mentions: one person under all their names", async () => {
  const { buildPeopleIndex, mentionMatcher, splitMentions } = await import("@/plugins/people/mentions");
  const index = buildPeopleIndex([
    { id: 1, name: "Christopher Kruger", aliases: [], whatsapp: "" },
    { id: 2, name: "Nadine", aliases: ["Nadi"], whatsapp: "Nadine" },
    { id: 3, name: "Anna Schmidt", aliases: [], whatsapp: "" },
    { id: 4, name: "Anna Weber", aliases: [], whatsapp: "" },
  ]);
  const m = mentionMatcher(index);
  const who = (text: string) => splitMentions(text, m).flatMap((x) => (x.person ? [`${x.text}→${x.person.id}`] : []));
  assert.deepEqual(who("Herr Kruger und Christopher Kruger"), ["Herr Kruger→1", "Christopher Kruger→1"]);
  assert.deepEqual(who("Nadines Geburtstag, Nadi fragen"), ["Nadines→2", "Nadi→2"]);
  // "Anna" is two people: neither; their last names are theirs.
  assert.deepEqual(who("Anna fragen, dann Frau Weber und Schmidt"), ["Frau Weber→4", "Schmidt→3"]);
  // Lower case isn't a name.
  assert.deepEqual(who("kruger"), []);
});

/** Two profiles that are one person: merged — names, addresses, dates come along. */
test("people: merge two profiles", async () => {
  const { createPerson, addDate, mergePeople, getPerson, datesOf, listPeople } = await import("@/plugins/people/store");
  const keep = createPerson({ name: "Christopher Kruger", emails: ["ch.kruger@example.com"] });
  const drop = createPerson({ name: "Herr Kruger", whatsapp: "Kruger" });
  addDate(drop, { kind: "birthday", day: 3, month: 5 });
  mergePeople(keep, drop);
  const p = getPerson(keep)!;
  assert.deepEqual(p.aliases, ["Herr Kruger"]);
  assert.equal(p.whatsapp, "Kruger");
  assert.deepEqual(p.emails, ["ch.kruger@example.com"]);
  assert.equal(datesOf(keep).length, 1);
  assert.equal(getPerson(drop), null);
  assert.equal(listPeople().filter((x) => /Kruger/.test(x.name)).length, 1);
});
