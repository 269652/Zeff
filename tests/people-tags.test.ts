import assert from "node:assert/strict";
import test from "node:test";
import { buildPeopleIndex, mentionMatcher, splitTags } from "../src/plugins/people/mentions";

const index = buildPeopleIndex([
  { id: 1, name: "Julia Freidank", aliases: ["Julia", "jfreidank"], whatsapp: "" },
  { id: 2, name: "Jens Schumacher", aliases: ["jenschum"], whatsapp: "" },
]);

test("in a note, @-tagged people are found — by name, alias or username — and only those; names without an @ stay plain", () => {
  const m = mentionMatcher(index);
  const parts = splitTags("@Julia Freidank bitte prüfen. Julia weiß es schon, @jenschum auch — mail@julia.de bleibt.", m);
  const tagged = parts.filter((p) => p.person).map((p) => [p.text, p.person!.id]);
  assert.deepEqual(tagged, [["@Julia Freidank", 1], ["@jenschum", 2]]);
  // Everything else stays, in order, with no @ lost.
  assert.equal(parts.map((p) => p.text).join(""), "@Julia Freidank bitte prüfen. Julia weiß es schon, @jenschum auch — mail@julia.de bleibt.");
  assert.ok(!parts.some((p) => p.person && !p.text.startsWith("@")));
});

test("without an index or an @ the text is one plain piece", () => {
  assert.deepEqual(splitTags("Julia Freidank", mentionMatcher(index)), [{ text: "Julia Freidank" }]);
  assert.deepEqual(splitTags("@Julia", null), [{ text: "@Julia" }]);
});

import { mergeJiraNotes, type TodoSource, type TodoUserNote } from "../src/lib/boards/shared";

const jiraComment = (id: string) => ({ source: "jira-comment", comment: { id, ticket: "PROJ-364", author: "Moritz Roessler", at: "2026-10-12T11:53:00Z", body: "x", url: null } }) as unknown as TodoSource;

test("a note synced to Jira and the Jira comment it became are one entry, not two", () => {
  const notes: TodoUserNote[] = [
    { at: "2026-10-12T11:27:00Z", text: "Notiz", jiraCommentId: "2486710", jiraText: "Notiz" },
    { at: "2026-10-12T10:00:00Z", text: "Nur lokal" },
    { at: "2026-10-12T09:00:00Z", text: "Gesyncte Notiz, Kommentar noch nicht gelesen", jiraCommentId: "999" },
  ];
  const sources = [jiraComment("2486710"), jiraComment("111")];
  const r = mergeJiraNotes(sources, notes);
  assert.deepEqual(r.sources.map((s) => (s as { comment: { id: string } }).comment.id), ["111"], "the comment that is a note is gone from the sources");
  assert.equal((r.notes[0].jira as unknown as { comment: { id: string } }).comment.id, "2486710", "… and sits on its note");
  assert.equal(r.notes[1].jira, undefined);
  assert.equal(r.notes[2].jira, undefined, "no comment seen yet: just the note");
  assert.equal(r.notes.length, 3);
});
