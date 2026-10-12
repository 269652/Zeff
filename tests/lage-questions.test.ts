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
