import assert from "node:assert/strict";
import test from "node:test";
import { omniSearch } from "@/lib/todos/omnibar";
import type { TodoView } from "@/lib/todos/shared";

const todo = (id: number, over: Partial<TodoView>): TodoView =>
  ({ id, ref: `T-${id}`, ticket: "", alsoTickets: [], text: "", kind: "other", status: "open", refs: [], mailRefs: [], userNotes: [], planned: [], note: null, draft: null, ...over }) as unknown as TodoView;

const todos = [
  todo(1, { ticket: "PROJ-364", text: "Nach dem Deployment Titel und Icon prüfen", kind: "test", refs: ["mail:m1", "jira-comment:c1"], userNotes: [{ at: "2026-10-12T11:00:00Z", text: "Umsetzung ist auf Test deployed" }] }),
  todo(2, { ticket: "PROJ-364", text: "Jens im Ticket Bescheid geben", refs: ["mail:m1"], planned: [{ path: null, steps: [{ text: "Live-Deployment abwarten", kind: "other", owner: "me", ops: [] }] }] }),
  todo(3, { ticket: "PROJ-400", text: "Anführungszeichen umwandeln", kind: "test", mailRefs: ["mail:m2"] }),
  todo(4, { ticket: "PROJ-400", text: "Quote-Variante umsetzen", status: "done", refs: ["doc:7", "keep:k1"] }),
];

const cand = (ref: string, title: string, text = "", score = 1) => ({ source: "mails" as const, ref, title, text, score });
const deps = {
  ticketSummary: (k: string) => (k === "PROJ-364" ? "Titel der Startseite" : k === "PROJ-400" ? "Anführungszeichen" : ""),
  searchers: {
    mails: async (words: string[]) => [cand("mail:m1", "Rico: Updates für PROJ-364", "Titel live"), cand("mail:m2", "Rico: Zeichen", "Anführungszeichen"), cand("mail:nobody", "Werbung", "Titel", 1)].filter((c) => words.some((w) => `${c.title} ${c.text}`.toLowerCase().includes(w))),
    teams: async () => [],
    gitlab: async () => [],
    jira: async (words: string[]) => (words.includes("deployed") || words.includes("titel") ? [{ source: "jira" as const, ref: "jira-comment:c1", title: "PROJ-364 · Moritz", text: "Titel ist deployed", score: 1 }] : []),
    notes: async () => [],
    facts: async () => [],
  },
  docs: () => new Map([["doc:7", { name: "Figma-Quote.pdf", abstract: "Quote-Variante der Startseite" }]]),
  keep: () => new Map([["keep:k1", { title: "Startseite Ideen", text: "Quote groß" }]]),
  people: [{ id: 5, name: "Jens Schumacher", aliases: ["Jens"] }],
};

test("a ticket brings all its todos; a mail that two todos cite brings both; a hit nobody cites isn't offered", async () => {
  const hits = await omniSearch("Titel", todos, deps);
  const ticket = hits.find((h) => h.key === "ticket:PROJ-364")!;
  assert.deepEqual(ticket.todoIds.sort(), [1, 2]);
  const mail = hits.find((h) => h.key === "mail:m1")!;
  assert.deepEqual(mail.todoIds.sort(), [1, 2], "one mail, two todos");
  assert.ok(!hits.some((h) => h.key === "mail:nobody"), "no todo cites it");
  // The text hit (first) is everything found together.
  assert.equal(hits[0].kind, "text");
  assert.deepEqual(hits[0].todoIds.sort(), [1, 2]);
});

test("a todo's context comment, a mail only the relation run found, its notes and plan, documents and Keep notes are searchable", async () => {
  assert.deepEqual((await omniSearch("deployed", todos, deps)).find((h) => h.key === "jira-comment:c1")!.todoIds, [1]);
  assert.deepEqual((await omniSearch("Anführungszeichen", todos, deps)).find((h) => h.key === "mail:m2")!.todoIds, [3], "found through mailRefs");
  const note = (await omniSearch("Umsetzung", todos, deps)).find((h) => h.kind === "note")!;
  assert.deepEqual(note.todoIds, [1]);
  assert.equal((await omniSearch("Live-Deployment", todos, deps)).find((h) => h.kind === "todo")!.todoIds[0], 2, "a planned step");
  assert.deepEqual((await omniSearch("Figma", todos, deps)).find((h) => h.kind === "doc")!.todoIds, [4]);
  assert.deepEqual((await omniSearch("Startseite Ideen", todos, deps)).find((h) => h.kind === "keep")!.todoIds, [4]);
});

test("kinds and people: Test brings the test todos, a name the todos that mention it", async () => {
  const kind = (await omniSearch("test", todos, deps)).find((h) => h.kind === "kind");
  assert.ok(kind && kind.todoIds.sort().join() === "1,3");
  const person = (await omniSearch("jens", todos, deps)).find((h) => h.kind === "person")!;
  assert.deepEqual(person.todoIds, [2]);
});

test("too short or no match: nothing; a failing searcher doesn't spoil the rest", async () => {
  assert.deepEqual(await omniSearch("t", todos, deps), []);
  assert.deepEqual(await omniSearch("xyzxyz", todos, deps), []);
  const broken = { ...deps, searchers: { ...deps.searchers, mails: async () => { throw new Error("db"); } } };
  assert.ok((await omniSearch("Titel", todos, broken)).some((h) => h.key === "ticket:PROJ-364"));
});
