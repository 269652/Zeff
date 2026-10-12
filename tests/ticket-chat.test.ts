import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

async function setup(key: string) {
  const { getDb, schema } = await import("@/db");
  getDb().insert(schema.jiraTickets).values({ key, summary: `Kategoriebäume migrieren ${key}`, status: "In progress", statusCategory: "indeterminate", description: "Die sys_categories sollen migriert werden.", syncedAt: new Date().toISOString() } as never).run();
  getDb().insert(schema.jiraComments).values({ id: `c-${key}`, ticket: key, author: "Christopher Lorenz", body: "Warum vier MRs für dasselbe Ticket?", at: new Date().toISOString() } as never).run();
}

test("a question about a ticket is answered from its data; what the AI misses it asks for and gets looked up (knowledge base and Zeff's data) — and it is kept as context on the ticket", async () => {
  await setup("CH-1");
  const { askTicket, ticketChat } = await import("@/lib/boards/ticket-chat");
  const { addFollowUp } = await import("@/lib/boards/store");
  addFollowUp({ ticket: "CH-1", text: "Mit Nikolai einen Termin abstimmen", kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  const prompts: string[] = [];
  const searched: string[] = [];
  const item = await askTicket("CH-1", "Was für Kritik hat Christopher?", {
    knowledge: async (q) => (searched.push(q), [{ title: "MR-Richtlinie", snippet: "Pro Ticket genau ein Merge Request." }]),
    ask: async (prompt) =>
      (prompts.push(prompt), prompts.length === 1 ? { answer: "", needs: [{ query: "Merge Request Richtlinie Ticket" }] } : { answer: "Er fragt, warum es vier MRs für ein Ticket gibt.", sources: ["MR-Richtlinie"] }),
  });
  assert.deepEqual(searched, ["Merge Request Richtlinie Ticket"]); // looked up when the AI asked for it
  assert.doesNotMatch(prompts[0], /Pro Ticket genau ein Merge Request/); // not preloaded
  assert.match(prompts[1], /Pro Ticket genau ein Merge Request/); // what the lookup found, in the second round
  assert.match(prompts[0], /Kategoriebäume migrieren CH-1/); // the ticket
  assert.match(prompts[0], /sys_categories/); // its description
  assert.match(prompts[0], /Warum vier MRs/); // its comments
  assert.match(prompts[0], /Termin abstimmen/); // its open todos
  assert.match(prompts[0], /Was für Kritik hat Christopher\?/);
  assert.equal(item.q, "Was für Kritik hat Christopher?");
  assert.equal(item.a, "Er fragt, warum es vier MRs für ein Ticket gibt.");
  assert.deepEqual(item.sources, ["MR-Richtlinie"]);
  assert.deepEqual(ticketChat("CH-1").map((c) => c.q), ["Was für Kritik hat Christopher?"]);
  assert.deepEqual(ticketChat("CH-2"), []);
});

test("earlier answers go into the next question's prompt; dismissing one takes it out of the context", async () => {
  await setup("CH-3");
  const { askTicket, ticketChat, dismissChatItem } = await import("@/lib/boards/ticket-chat");
  const { listContexts } = await import("@/lib/contexts");
  const prompts: string[] = [];
  const deps = { ask: async (p: string) => (prompts.push(p), { answer: `Antwort ${prompts.length}` }) };
  const first = await askTicket("CH-3", "Erste Frage?", deps);
  await askTicket("CH-3", "Zweite Frage?", deps);
  assert.match(prompts[1], /Erste Frage\?/);
  assert.match(prompts[1], /Antwort 1/);
  assert.equal(ticketChat("CH-3").length, 2);
  // It's context of the ticket (the briefing's prompt reads it from there).
  assert.ok(listContexts().some((c) => c.ticket === "CH-3" && /Antwort 1/.test(c.body)));
  dismissChatItem(first.id);
  assert.deepEqual(ticketChat("CH-3").map((c) => c.q), ["Zweite Frage?"]);
  assert.ok(!listContexts().some((c) => /Antwort 1/.test(c.body)));
  // Only chat items can be dismissed this way — not any other context.
  const { createContext } = await import("@/lib/contexts");
  const other = await createContext({ kind: "note", title: "Meine Notiz", author: "Ich", body: "bleibt", links: [], date: null, ticket: "CH-3" });
  assert.throws(() => dismissChatItem(other.id), /isn't a chat answer/);
});

test("nothing is kept for an empty question or an answer the AI didn't give", async () => {
  await setup("CH-4");
  const { askTicket, ticketChat } = await import("@/lib/boards/ticket-chat");
  await assert.rejects(askTicket("CH-4", "   ", { ask: async () => ({ answer: "x" }) }), /question/i);
  await assert.rejects(askTicket("CH-4", "Frage?", { ask: async () => ({ answer: "  " }) }), /answer/i);
  assert.deepEqual(ticketChat("CH-4"), []);
});

test("what was asked about a ticket reaches its todos' briefs (workers, agents over MCP) — until it's dismissed", async () => {
  await setup("CH-5");
  const { askTicket, dismissChatItem } = await import("@/lib/boards/ticket-chat");
  const { addFollowUp } = await import("@/lib/boards/store");
  const { briefFor } = await import("@/lib/work/brief");
  const todo = addFollowUp({ ticket: "CH-5", text: "MR anpassen", kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  const item = await askTicket("CH-5", "Warum vier MRs?", { ask: async () => ({ answer: "Weil die Migration in Teile zerlegt wurde." }) });
  assert.match(briefFor(todo), /Warum vier MRs\?[\s\S]*Weil die Migration in Teile zerlegt wurde/);
  dismissChatItem(item.id);
  assert.doesNotMatch(briefFor(todo), /Warum vier MRs/);
});
