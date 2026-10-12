import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ticket = (extra: Record<string, unknown>) => ({ key: "QQ-1", attention: "active", lead: "l", summary: "s", happened: [], todos: [], resolved: [], flags: [], actions: [], ...extra });
const analyzed = [{ key: "QQ-1", analyzed: true }] as never;

test("the Lage schema asks for possible questions; the run keeps up to five, trimmed, without empty ones", async () => {
  const { BOARD_RESULT_SCHEMA } = await import("@/lib/boards/shared");
  const { cleanResult } = await import("@/lib/boards/run");
  const props = (BOARD_RESULT_SCHEMA.properties.tickets.items.properties as unknown as Record<string, { items?: { required?: string[] } }>).questions;
  assert.deepEqual(props.items?.required, ["q"]);
  const r = cleanResult(
    { lede: "", left: [], tickets: [ticket({ questions: [{ q: "  Was für Kritik? ", a: " Zu viele MRs " }, { q: "" }, { a: "ohne Frage" }, { q: "Wie läuft das Deployment?", search: " Deployment Ablauf " }, ...Array.from({ length: 8 }, (_, i) => ({ q: `Frage ${i}` }))] })] } as never,
    analyzed,
  );
  const q = r.tickets[0].questions!;
  assert.equal(q.length, 5);
  assert.deepEqual(q[0], { q: "Was für Kritik?", a: "Zu viele MRs" });
  assert.deepEqual(q[1], { q: "Wie läuft das Deployment?", search: "Deployment Ablauf" });
});

test("questions the context didn't answer are answered from what the knowledge search finds — only then, and only with it", async () => {
  const { answerOpenQuestions } = await import("@/lib/boards/questions");
  const searched: string[] = [];
  const asked: string[] = [];
  const result = {
    lede: "",
    left: [],
    tickets: [
      ticket({ questions: [{ q: "Was für Kritik?", a: "Zu viele MRs" }, { q: "Wie läuft das Deployment?", search: "Deployment" }, { q: "Wer ist zuständig?", search: "Zuständigkeit" }] }),
    ],
  } as never;
  await answerOpenQuestions(result, {
    search: async (q) => {
      searched.push(q);
      return q === "Deployment" ? [{ title: "Deployment-Guide", snippet: "Deployed wird über die Pipeline auf Test." }] : [];
    },
    ask: async (items) => {
      asked.push(...items.map((i) => i.question));
      return items.map((i) => ({ id: i.id, answer: "Über die Pipeline auf Test.", sources: ["Deployment-Guide"] }));
    },
  });
  assert.deepEqual(searched, ["Deployment", "Zuständigkeit"]); // the answered one isn't searched
  assert.deepEqual(asked, ["Wie läuft das Deployment?"]); // nothing found for the other: not asked, not guessed
  const q = (result as { tickets: { questions: Record<string, unknown>[] }[] }).tickets[0].questions;
  assert.equal(q[0].a, "Zu viele MRs");
  assert.equal(q[1].a, "Über die Pipeline auf Test.");
  assert.deepEqual(q[1].sources, ["Deployment-Guide"]);
  assert.equal(q[2].a, undefined);
});

test("a failing knowledge search or AI leaves the questions as they are — the run goes on", async () => {
  const { answerOpenQuestions } = await import("@/lib/boards/questions");
  const result = { lede: "", left: [], tickets: [ticket({ questions: [{ q: "Frage?", search: "x" }] })] } as never;
  await answerOpenQuestions(result, { search: async () => { throw new Error("down"); }, ask: async () => { throw new Error("no"); } });
  assert.equal((result as { tickets: { questions: { a?: string }[] }[] }).tickets[0].questions[0].a, undefined);
});

test("every flag and every vague statement is a reason for a question: the instructions say so, and the flags come before the questions in the answer", async () => {
  const { BOARD_RESULT_SCHEMA } = await import("@/lib/boards/shared");
  const { INSTRUCTIONS } = await import("@/lib/boards/collect");
  const props = BOARD_RESULT_SCHEMA.properties.tickets.items.properties as unknown as Record<string, { description?: string }>;
  const order = Object.keys(props);
  assert.ok(order.indexOf("flags") < order.indexOf("questions"), "the model writes the flags first, then asks about them");
  assert.match(props.questions.description ?? "", /flags/i);
  const bullet = /- questions:[\s\S]*?(?=\n  - |\n- )/.exec(INSTRUCTIONS)?.[0] ?? "";
  assert.match(bullet, /flags/i);
  assert.match(bullet, /Rückfrage/); // the example: "Rückfrage seit 07.10. offen" → "Was für eine Rückfrage?"
  assert.match(bullet, /JEDEM/); // each flag, not just some
});

test("the briefing sees what you noted on a ticket's todos — open or done lately — and is told a note that says something is settled settles it for the whole ticket", async () => {
  const { addFollowUp, addTodoUserNote, setTodoStatus } = await import("@/lib/boards/store");
  const { ticketBlock, INSTRUCTIONS } = await import("@/lib/boards/collect");
  const open = addFollowUp({ ticket: "NT-1", text: "Pipeline prüfen, dann auf Test kontrollieren, dass der Titel stimmt", kind: "test", parentId: null as unknown as number, workRunId: null, source: "test" });
  addTodoUserNote(open.id, "Habe ich heute auf Test geprüft: Titel blau, Zusatz grau, Icon da, Link öffnet im neuen Fenster.");
  const done = addFollowUp({ ticket: "NT-1", text: "Mit Jens klären", kind: "clarify", parentId: null as unknown as number, workRunId: null, source: "test" });
  addTodoUserNote(done.id, "Jens hat bestätigt, dass es so passt.");
  setTodoStatus(done.id, "done");
  const block = ticketBlock({ key: "NT-1", summary: "Bestellen blau" } as never, null);
  assert.match(block, /MEINE NOTIZ[^\n]*Habe ich heute auf Test geprüft/);
  assert.match(block, /erledigt[^\n]*Mit Jens klären[^\n]*MEINE NOTIZ[^\n]*Jens hat bestätigt/);
  const rule = /MEINE NOTIZ[\s\S]*?(?=\n\n|$)/.exec(INSTRUCTIONS)?.[0] ?? "";
  assert.match(rule, /ganze[ns]? Ticket/i);
  assert.match(rule, /erledigt|getestet|geklärt/);
});
